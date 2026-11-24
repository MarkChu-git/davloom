import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListPage } from "@davloom/storage/object-store";
import { createS3Client, createS3Driver } from "@davloom/storage/s3";
import {
  SECRET,
  SETUP_TOKEN,
  startDavloom,
  startWorkersServer,
  stringField,
  type Davloom,
} from "./davloom";
import { startS3Proxy, type S3Proxy } from "./s3-proxy";
import { ACCESS_KEY, hasDocker, SECRET_KEY, startSelfHostedServer } from "./selfhosted";
import { startBunServer } from "./servers";

// The deployments whose files live in an S3-compatible store reached through the fault-injecting
// proxy of s3-proxy.ts, so a test can make the store fail while Davloom serves WebDAV:
//
// - the production Worker in local workerd, with an S3 backend registered through the management
//   API whose endpoint is the proxy, which serves an in-memory S3;
// - the Bun entry with SQLite, whose default backend's endpoint is the proxy with an in-memory S3;
// - the Bun entry with SQLite and RustFS in Docker behind the proxy, the self-hosted deployment.
//
// Each gives the tests the store's keys as they are, read past the proxy, so a test can check what
// a failed request left behind without asking Davloom.

export const BUCKET = "davloom";

/** The store's objects, read and written past the proxy. */
export interface StoreView {
  /** Every key with its content as text. */
  snapshot(): Promise<Record<string, string>>;
  /** Removes every key, then stores these. */
  reset(objects: Readonly<Record<string, string>>): Promise<void>;
  /** Stores many objects at once. */
  putMany(objects: readonly (readonly [key: string, body: string])[]): Promise<void>;
  /** The keys under a prefix, in the store's order. */
  keys(prefix: string): Promise<string[]>;
}

export interface S3Deployment {
  readonly davloom: Davloom;
  readonly proxy: S3Proxy;
  /** The WebDAV path of the Mount on the store's bucket root, such as `/files`. */
  readonly mount: string;
  readonly store: StoreView;
  /** The most objects one COPY or MOVE may touch on this deployment. */
  readonly maxEntries: number;
  stop(): Promise<void>;
}

export interface S3Target {
  readonly name: string;
  readonly skip: boolean;
  /** Whether the in-memory store serves the bucket, so its page size can be set. */
  readonly memory: boolean;
  readonly start: (options?: { readonly pageSize?: number }) => Promise<S3Deployment>;
}

const memoryView = (proxy: S3Proxy): StoreView => {
  const objects = () => {
    const memory = proxy.memory;
    if (!memory) throw new Error("the proxy serves no in-memory store");
    return { memory, bucket: memory.bucket(BUCKET) };
  };
  const decoder = new TextDecoder();
  return {
    snapshot: async () => {
      const result: Record<string, string> = {};
      for (const [key, object] of objects().bucket) result[key] = decoder.decode(object.body);
      return result;
    },
    reset: async (seed) => {
      const { memory, bucket } = objects();
      bucket.clear();
      for (const [key, body] of Object.entries(seed)) memory.put(BUCKET, key, body);
    },
    putMany: async (entries) => {
      const { memory } = objects();
      for (const [key, body] of entries) memory.put(BUCKET, key, body);
    },
    keys: async (prefix) =>
      [...objects().bucket.keys()]
        .filter((key) => key.startsWith(prefix))
        .toSorted((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
  };
};

/** Runs `work` on every item, 16 at a time. */
const inLanes = async <T>(items: readonly T[], work: (item: T) => Promise<void>) => {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await work(item);
    }
  };
  await Promise.all(Array.from({ length: 16 }, lane));
};

/** The value of a result, or an error that names what failed. */
const must = <T>(result: { ok: true; value: T } | { ok: false; failure: string }, what: string) => {
  if (!result.ok) throw new Error(`${what} failed: ${result.failure}`);
  return result.value;
};

/** Reads and writes a store through the S3 driver, at its own endpoint rather than the proxy. */
export const driverView = (endpoint: string, bucket = BUCKET): StoreView => {
  const driver = createS3Driver({
    client: createS3Client({
      endpoint,
      region: "us-east-1",
      bucket,
      forcePathStyle: true,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    }),
    bucket,
  });
  const keys = async (prefix: string) => {
    const found: string[] = [];
    let cursor: string | null = null;
    do {
      const page: ListPage = must(
        await driver.list(prefix, { recursive: true, cursor }),
        "listing",
      );
      found.push(...page.objects.map((object) => object.key));
      cursor = page.cursor;
    } while (cursor !== null);
    return found;
  };
  const putMany = (entries: readonly (readonly [string, string])[]) =>
    inLanes(entries, async ([key, body]) => {
      const bytes = new TextEncoder().encode(body);
      must(
        await driver.put(key, new Blob([bytes]).stream(), {
          length: bytes.byteLength,
          created: Date.now(),
        }),
        `putting ${key}`,
      );
    });
  return {
    snapshot: async () => {
      const all = await keys("");
      const contents = new Map<string, string>();
      await inLanes(all, async (key) => {
        const read = must(await driver.get(key), `reading ${key}`);
        contents.set(key, read ? await new Response(read.body).text() : "<gone>");
      });
      // In the store's order, as the in-memory view gives them.
      return Object.fromEntries(all.map((key) => [key, contents.get(key) ?? "<gone>"]));
    },
    reset: async (seed) => {
      const all = await keys("");
      for (let index = 0; index < all.length; index += 1000) {
        must(await driver.delete(all.slice(index, index + 1000)), "deleting");
      }
      await putMany(Object.entries(seed));
    },
    putMany,
    keys,
  };
};

/** Registers an S3 backend at the proxy and a Mount `s3` on its bucket root. */
const mountS3 = async (davloom: Davloom, proxy: S3Proxy) => {
  const created = await davloom.api("/api/backends", {
    method: "POST",
    body: JSON.stringify({
      name: "Proxied S3",
      kind: "s3",
      config: {
        endpoint: proxy.url,
        region: "us-east-1",
        bucket: BUCKET,
        forcePathStyle: true,
        accessKeyId: ACCESS_KEY,
      },
      secretKey: SECRET_KEY,
    }),
  });
  if (created.status !== 201) {
    throw new Error(`backend failed: ${created.status} ${await created.text()}`);
  }
  const backendId = stringField(await created.json(), "id");
  const mount = await davloom.api("/api/mounts", {
    method: "POST",
    body: JSON.stringify({ name: "s3", backendId, root: "" }),
  });
  if (mount.status !== 201) throw new Error(`mount failed: ${mount.status} ${await mount.text()}`);
};

/**
 * A product bug keeps an S3 backend from working on Workers at all: the Worker bundle takes the
 * browser build of the AWS SDK's XML parser (@aws-sdk/xml-builder's `xml-parser.browser`, chosen
 * by its package.json `browser` field), which calls `DOMParser`, and workerd has none. Every S3
 * answer with an XML body, every listing among them, fails with "DOMParser is not defined", so
 * every request to the Mount answers 503. s3-workers.test.ts shows it; until it is fixed, the
 * tables skip the Workers target unless DAVLOOM_TEST_WORKERS_S3=1, which runs it as after a fix.
 */
export const RUN_WORKERS_S3 = process.env.DAVLOOM_TEST_WORKERS_S3 === "1";

/** Starts the production Worker in local workerd with a Mount `s3` on the in-memory S3. */
export const startWorkersWithS3 = async ({ pageSize }: { readonly pageSize?: number } = {}) => {
  const proxy = startS3Proxy({ pageSize });
  try {
    const davloom = await startDavloom(startWorkersServer);
    await mountS3(davloom, proxy);
    return {
      davloom,
      proxy,
      mount: "/s3",
      store: memoryView(proxy),
      maxEntries: 30,
      stop: async () => {
        await davloom.server.stop();
        await proxy.stop();
      },
    };
  } catch (error) {
    await proxy.stop();
    throw error;
  }
};

export const S3_TARGETS: readonly S3Target[] = [
  {
    name: "Workers with an S3 backend (in-memory S3)",
    skip: !RUN_WORKERS_S3,
    memory: true,
    start: startWorkersWithS3,
  },
  {
    name: "Bun with SQLite and an in-memory S3",
    skip: false,
    memory: true,
    start: async ({ pageSize } = {}) => {
      const proxy = startS3Proxy({ pageSize });
      const dataDir = mkdtempSync(join(tmpdir(), "davloom-s3-proxy-"));
      try {
        const davloom = await startDavloom(() =>
          startBunServer("apps/api/src/entry.bun.ts", {
            DAVLOOM_SECRET: SECRET,
            DAVLOOM_SETUP_TOKEN: SETUP_TOKEN,
            DAVLOOM_DATA_DIR: dataDir,
            DAVLOOM_S3_ENDPOINT: proxy.url,
            DAVLOOM_S3_ACCESS_KEY_ID: ACCESS_KEY,
            DAVLOOM_S3_SECRET_ACCESS_KEY: SECRET_KEY,
            DAVLOOM_S3_BUCKET: BUCKET,
          }),
        );
        return {
          davloom,
          proxy,
          mount: "/files",
          store: memoryView(proxy),
          maxEntries: 1000,
          stop: async () => {
            await davloom.server.stop();
            await proxy.stop();
            rmSync(dataDir, { recursive: true, force: true });
          },
        };
      } catch (error) {
        await proxy.stop();
        rmSync(dataDir, { recursive: true, force: true });
        throw error;
      }
    },
  },
  {
    name: "Bun with SQLite and RustFS",
    skip: !hasDocker(),
    memory: false,
    start: async () => {
      let proxy: S3Proxy | undefined;
      let rustfs = "";
      try {
        const davloom = await startDavloom(() =>
          startSelfHostedServer({
            endpointFor: (endpoint) => {
              rustfs = endpoint;
              proxy = startS3Proxy({ upstream: endpoint });
              return proxy.url;
            },
          }),
        );
        if (!proxy) throw new Error("the self-hosted server started without the proxy");
        const started = proxy;
        return {
          davloom,
          proxy: started,
          mount: "/files",
          store: driverView(rustfs),
          maxEntries: 1000,
          stop: async () => {
            await davloom.server.stop();
            await started.stop();
          },
        };
      } catch (error) {
        await proxy?.stop();
        throw error;
      }
    },
  },
];

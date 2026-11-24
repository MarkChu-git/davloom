// The release smoke test (PRD §15): checks a running deployment end to end with one Read/Write
// API Key, and leaves nothing behind but what it could not delete.
//
//   DAVLOOM_SMOKE_KEY=dav_… bun scripts/smoke.ts https://davloom.example.com
//
// It works in a new folder of the first Mount, and removes the folder at the end.

export interface SmokeOptions {
  /** The deployment's origin, such as https://davloom.example.com. */
  readonly url: string;
  /** A Read/Write API Key. */
  readonly key: string;
  readonly fetch?: (request: Request) => Promise<Response>;
  readonly log?: (line: string) => void;
}

export interface SmokeResult {
  readonly passed: string[];
  readonly failed: { readonly check: string; readonly reason: string }[];
}

class CheckFailed extends Error {}

const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>davloom smoke test</D:owner></D:lockinfo>';
const PROPPATCH_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:propertyupdate xmlns:D="DAV:" xmlns:S="urn:davloom:smoke"><D:set><D:prop><S:checked>yes</S:checked></D:prop></D:set></D:propertyupdate>';
const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:" xmlns:S="urn:davloom:smoke"><D:prop><S:checked/></D:prop></D:propfind>';

const expectStatus = async (response: Response, ...statuses: number[]) => {
  if (!statuses.includes(response.status)) {
    const text = await response.text().catch(() => "");
    throw new CheckFailed(
      `answered ${response.status}, not ${statuses.join(" or ")} ${text.slice(0, 200)}`,
    );
  }
};

const sha256 = async (bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export const runSmoke = async (options: SmokeOptions): Promise<SmokeResult> => {
  const origin = options.url.replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((request: Request) => fetch(request));
  const log = options.log ?? (() => undefined);
  const auth = `Basic ${btoa(`smoke:${options.key}`)}`;
  const result: SmokeResult = { passed: [], failed: [] };

  const send = (path: string, init: RequestInit & { anonymous?: boolean } = {}) => {
    const headers = new Headers(init.headers);
    if (!init.anonymous) headers.set("authorization", auth);
    return doFetch(new Request(`${origin}${path}`, { ...init, headers }));
  };

  const check = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
      result.passed.push(name);
      log(`ok    ${name}`);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result.failed.push({ check: name, reason });
      log(`FAIL  ${name}: ${reason}`);
      return false;
    }
  };

  await check("the API answers its health check", async () => {
    const response = await send("/api/health", { anonymous: true });
    await expectStatus(response, 200);
    const body: unknown = await response.json();
    if (JSON.stringify(body) !== '{"status":"ok"}') throw new CheckFailed(JSON.stringify(body));
  });

  await check("the Dashboard loads", async () => {
    const response = await send("/", { anonymous: true });
    await expectStatus(response, 200);
    if (!(await response.text()).includes("<html")) throw new CheckFailed("no HTML page");
  });

  await check("setup is complete", async () => {
    const response = await send("/api/setup", { anonymous: true });
    await expectStatus(response, 200);
    const body: unknown = await response.json();
    if (JSON.stringify(body) !== '{"needed":false,"open":false}') {
      throw new CheckFailed(`setup state ${JSON.stringify(body)}`);
    }
  });

  await check("WebDAV asks for credentials", async () => {
    const response = await send("/dav/", {
      method: "PROPFIND",
      headers: { depth: "0" },
      anonymous: true,
    });
    await expectStatus(response, 401);
    if (!response.headers.get("www-authenticate")?.startsWith("Basic")) {
      throw new CheckFailed("no Basic challenge");
    }
  });

  await check("WebDAV advertises Class 1 and 2", async () => {
    const response = await send("/dav/", { method: "OPTIONS" });
    await expectStatus(response, 200);
    if (response.headers.get("dav") !== "1, 2") {
      throw new CheckFailed(`DAV: ${response.headers.get("dav")}`);
    }
  });

  // Set inside the check below; a holder keeps TypeScript from reading it as always null.
  const found: { mount?: string } = {};
  await check("the key lists the Mounts", async () => {
    const response = await send("/dav/", { method: "PROPFIND", headers: { depth: "1" } });
    await expectStatus(response, 207);
    const hrefs = [...(await response.text()).matchAll(/<D:href>\/dav\/([^/<]+)\/<\/D:href>/g)];
    found.mount = hrefs[0]?.[1];
    if (found.mount === undefined) throw new CheckFailed("no Mount reachable with this key");
  });
  if (found.mount === undefined) return result;

  const folder = `/dav/${found.mount}/davloom-smoke-${Date.now().toString(36)}`;
  const file = `${folder}/file.bin`;
  const bytes = crypto.getRandomValues(new Uint8Array(1024 * 1024 + 7));
  try {
    if (
      !(await check("creates a folder", async () => {
        await expectStatus(await send(`${folder}/`, { method: "MKCOL" }), 201);
      }))
    ) {
      return result;
    }

    await check("stores and reads back 1 MiB unchanged", async () => {
      await expectStatus(await send(file, { method: "PUT", body: bytes }), 201);
      const read = await send(file);
      await expectStatus(read, 200);
      if ((await sha256(await read.arrayBuffer())) !== (await sha256(bytes))) {
        throw new CheckFailed("the content differs");
      }
    });

    await check("serves a byte range", async () => {
      const response = await send(file, { headers: { range: "bytes=1000-1999" } });
      await expectStatus(response, 206);
      const slice = new Uint8Array(await response.arrayBuffer());
      if (slice.length !== 1000 || slice.some((b, i) => b !== bytes[1000 + i])) {
        throw new CheckFailed("the range differs");
      }
    });

    await check("keeps a dead property", async () => {
      await expectStatus(await send(file, { method: "PROPPATCH", body: PROPPATCH_BODY }), 207);
      const response = await send(file, {
        method: "PROPFIND",
        headers: { depth: "0" },
        body: PROPFIND_BODY,
      });
      await expectStatus(response, 207);
      if (!(await response.text()).includes(">yes<"))
        throw new CheckFailed("the property is missing");
    });

    await check("locks, refuses a write without the token, and unlocks", async () => {
      const lock = await send(file, {
        method: "LOCK",
        headers: { timeout: "Second-60" },
        body: LOCK_BODY,
      });
      await expectStatus(lock, 200);
      const token = lock.headers.get("lock-token") ?? "";
      await expectStatus(await send(file, { method: "PUT", body: "x" }), 423);
      await expectStatus(
        await send(file, { method: "PUT", body: bytes, headers: { if: `(${token})` } }),
        204,
      );
      await expectStatus(
        await send(file, { method: "UNLOCK", headers: { "lock-token": token } }),
        204,
      );
    });

    await check("copies and moves", async () => {
      const copy = `${origin}${folder}/copy.bin`;
      await expectStatus(await send(file, { method: "COPY", headers: { destination: copy } }), 201);
      await expectStatus(
        await send(`${folder}/copy.bin`, {
          method: "MOVE",
          headers: { destination: `${origin}${folder}/moved.bin` },
        }),
        201,
      );
      await expectStatus(await send(`${folder}/copy.bin`), 404);
      await expectStatus(await send(`${folder}/moved.bin`, { method: "HEAD" }), 200);
    });
  } finally {
    await check("deletes the folder", async () => {
      await expectStatus(await send(`${folder}/`, { method: "DELETE" }), 204);
      await expectStatus(
        await send(`${folder}/`, { method: "PROPFIND", headers: { depth: "0" } }),
        404,
      );
    });
  }
  return result;
};

if (import.meta.main) {
  const [url] = Bun.argv.slice(2);
  const key = process.env.DAVLOOM_SMOKE_KEY;
  if (!url || !key) {
    console.error("Usage: DAVLOOM_SMOKE_KEY=dav_… bun scripts/smoke.ts <origin>");
    process.exit(2);
  }
  const result = await runSmoke({ url, key, log: (line) => console.log(line) });
  console.log(`${result.passed.length} passed, ${result.failed.length} failed`);
  process.exit(result.failed.length === 0 ? 0 : 1);
}

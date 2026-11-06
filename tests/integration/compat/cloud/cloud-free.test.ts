import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startWorkerdServerWithDatabase, type Server } from "../http/servers";
import { PROBE_TOKEN_HEADER } from "../probe/token-guard";
import { countBy, distributionOf } from "./stats";
import { pollUntil, startTail, type Tail, type TailEvent } from "./tail";

// Set by scripts/cloud-free.ts for a real deployment.
const DEPLOYED_URL = process.env.DAVLOOM_PROBE_URL;
const DEPLOYED_TOKEN = process.env.DAVLOOM_PROBE_TOKEN ?? "";
const CLOUD_CONFIG = process.env.DAVLOOM_PROBE_CONFIG ?? "";
const WORKER_NAME = process.env.DAVLOOM_PROBE_WORKER ?? "";
const IS_LOCAL = process.env.DAVLOOM_PROBE_LOCAL === "1";
const IS_DEPLOYED = Boolean(DEPLOYED_URL);

const COMPAT_DIRECTORY = resolve(import.meta.dirname, "..");
const RESULTS_FILE = resolve(
  COMPAT_DIRECTORY,
  "test-results/cloud-free",
  IS_DEPLOYED ? "results.json" : "results.local.json",
);

const LOCAL_TOKEN = "local-dry-run-token";
const ADMIN_EMAIL = "admin@davloom.test";
const WEBDAV_METHODS = [
  "OPTIONS",
  "GET",
  "HEAD",
  "PUT",
  "DELETE",
  "PROPFIND",
  "PROPPATCH",
  "MKCOL",
  "COPY",
  "MOVE",
  "LOCK",
  "UNLOCK",
];
const WEBDAV_HEADERS = {
  depth: "1",
  destination: "https://example.com/dav/%E7%9B%AE%E6%A0%87/b.txt",
  if: "(<urn:uuid:181d4fae-7d8c-11d0-a765-00a0c91e6bf2>)",
  "lock-token": "<urn:uuid:181d4fae-7d8c-11d0-a765-00a0c91e6bf2>",
  overwrite: "F",
  timeout: "Second-600",
};

const API_KEY_REQUESTS = 100;
const LOGIN_REQUESTS = 20;
const OBJECT_LOGIN_REQUESTS = 5;
const UPLOAD_BYTES = 95_000_000;
const OVERSIZED_BYTES = 105_000_000;
const OBJECT_SIZE_BYTES = 1024;
// The Free plan writes 100,000 rows a day. Each object costs 5 rows to seed and 7 to churn.
const CHURN_STEPS = [100, 400, 2000];
const LISTING_CHILDREN = 100;
// Worker targets bracket the documented 10 ms, and object targets bracket the documented 30 s.
const WORKER_CPU_TARGETS_MS = [1, 2, 5, 10, 15, 20, 30, 50, 100, 200, 500, 1000];
const OBJECT_CPU_TARGETS_MS = IS_DEPLOYED
  ? [
      5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 20_000, 25_000, 29_000,
      31_000, 35_000, 45_000,
    ]
  : [5, 50, 500];
const CPU_ATTEMPTS_PER_TARGET = 3;
const SETUP_ATTEMPTS = 5;
const FIRST_BURN_ITERATIONS = 1_000_000;

const results: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  target: IS_DEPLOYED ? "workers.dev" : "local workerd",
};

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

const timed = async (request: () => Promise<Response>) => {
  const started = performance.now();
  const response = await request();
  const body = await response.text();
  return { status: response.status, body, clientMs: performance.now() - started };
};

const summarize = (
  responses: readonly { readonly status: number; readonly clientMs: number }[],
  events: readonly TailEvent[],
) => ({
  requests: responses.length,
  statuses: countBy(responses, ({ status }) => String(status)),
  clientMs: distributionOf(responses.map(({ clientMs }) => Math.round(clientMs))),
  cpuMs: distributionOf(events.flatMap(({ cpuTime }) => (cpuTime === null ? [] : [cpuTime]))),
  wallMs: distributionOf(events.flatMap(({ wallTime }) => (wallTime === null ? [] : [wallTime]))),
  outcomes: countBy(events, ({ outcome }) => outcome),
  tailEvents: events.length,
});

describe.skipIf(!IS_DEPLOYED && !IS_LOCAL)("Cloud Free measurements", () => {
  let server: Server | undefined;
  let baseUrl = "";
  let token = "";
  let tail: Tail | undefined;
  let password = "";
  let authorization: { authorization: string };

  const probe = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { [PROBE_TOKEN_HEADER]: token, ...init.headers },
    });

  const authenticated = (path: string, init: RequestInit = {}) =>
    probe(path, { ...init, headers: { ...authorization, ...init.headers } });

  const postJson = (send: typeof probe, path: string, body: unknown) =>
    send(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });

  const eventsFor = async (path: string, count: number, timeoutMs?: number): Promise<TailEvent[]> =>
    tail ? tail.waitFor((event) => pathOf(event.url) === path, count, timeoutMs) : [];

  const eventsWithPrefix = async (prefix: string, count: number): Promise<TailEvent[]> =>
    tail ? tail.waitFor((event) => pathOf(event.url).startsWith(prefix), count) : [];

  beforeAll(async () => {
    if (DEPLOYED_URL) {
      baseUrl = DEPLOYED_URL;
      token = DEPLOYED_TOKEN;
      const started = startTail(WORKER_NAME, CLOUD_CONFIG, COMPAT_DIRECTORY);
      tail = started;
      // Tail needs a moment to attach, and only a request that shows up in it proves that it has.
      // Without it there would be no CPU figures, so the run stops before it spends the row quota.
      const marker = `/api/health/tail-check-${Date.now()}`;
      const attached = await pollUntil(
        async () => {
          await (await probe(marker)).text();
          return started.events.some((event) => pathOf(event.url) === marker);
        },
        { timeoutMs: 60_000, intervalMs: 2000 },
      );
      if (!attached) {
        throw new Error(`wrangler tail did not attach within 60 s.\n${started.errorOutput()}`);
      }
    } else {
      server = await startWorkerdServerWithDatabase(
        "tests/integration/compat/probe/wrangler.jsonc",
        ["--var", `PROBE_TOKEN:${LOCAL_TOKEN}`],
      );
      baseUrl = server.url;
      token = LOCAL_TOKEN;
    }
  });

  afterEach(() => {
    mkdirSync(resolve(RESULTS_FILE, ".."), { recursive: true });
    writeFileSync(RESULTS_FILE, `${JSON.stringify(results, null, 2)}\n`);
  });

  afterAll(async () => {
    tail?.stop();
    await server?.stop();
  });

  it("hides the probe from anyone without the token", async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(404);
  });

  it("answers the production routes with the token", async () => {
    const response = await probe("/api/health");

    expect(response.status).toBe(200);
  });

  // A separate test, because a CPU limit on this cold path must not stop the measurements after it.
  it("creates the administrator and an API key", async () => {
    // The password exists for this run only, and its hash is computed here rather than in the Worker.
    password = randomBytes(24).toString("hex");
    const passwordHash = await hashPassword(password);
    const attempts: number[] = [];
    let key = "";
    for (let attempt = 0; attempt < SETUP_ATTEMPTS && !key; attempt += 1) {
      const setup = await postJson(probe, "/api/__probe/auth/setup-with-hash", { passwordHash });
      const keys = setup.ok ? await probe("/api/__probe/auth/api-keys", { method: "POST" }) : setup;
      attempts.push(keys.status);
      if (keys.status === 200) {
        ({ key } = (await keys.json()) as { key: string });
      }
    }
    authorization = { authorization: `Basic ${btoa(`client:${key}`)}` };

    results.setup = { attempts };
    expect(key).not.toBe("");
  });

  it.each(WEBDAV_METHODS)("%s and the WebDAV headers reach the handler", async (method) => {
    const response = await probe("/dav/%E6%96%87%E4%BB%B6%20a%2Fb.txt", {
      method,
      headers: WEBDAV_HEADERS,
    });
    const echo = JSON.parse(response.headers.get("x-probe-echo") ?? "{}") as {
      method: string;
      path: string;
      headers: Record<string, string>;
    };

    expect(echo.method).toBe(method);
    expect(echo.path).toBe("/dav/%E6%96%87%E4%BB%B6%20a%2Fb.txt");
    expect(echo.headers).toMatchObject(WEBDAV_HEADERS);
  });

  it(`measures ${API_KEY_REQUESTS} requests carrying an API key`, async () => {
    const responses = [];
    for (let index = 0; index < API_KEY_REQUESTS; index += 1) {
      responses.push(
        await timed(() =>
          authenticated(`/api/__probe/auth/dav/api-key-${index}.txt`, { method: "PROPFIND" }),
        ),
      );
    }
    const events = await eventsWithPrefix("/api/__probe/auth/dav/api-key-", API_KEY_REQUESTS);

    results.apiKeyRequests = summarize(responses, events);
    expect(responses).toHaveLength(API_KEY_REQUESTS);
    if (IS_LOCAL) {
      expect(results.apiKeyRequests).toMatchObject({ statuses: { 200: API_KEY_REQUESTS } });
    }
  });

  it(`measures ${LOGIN_REQUESTS} administrator logins in the Worker`, async () => {
    const responses = [];
    for (let index = 0; index < LOGIN_REQUESTS; index += 1) {
      responses.push(
        await timed(() =>
          postJson(probe, "/api/__probe/auth/login", { email: ADMIN_EMAIL, password }),
        ),
      );
    }
    const events = await eventsFor("/api/__probe/auth/login", LOGIN_REQUESTS);

    results.workerLogins = summarize(responses, events);
    if (IS_LOCAL) {
      expect(results.workerLogins).toMatchObject({ statuses: { 200: LOGIN_REQUESTS } });
    }
  });

  it(`measures ${OBJECT_LOGIN_REQUESTS} administrator logins inside the object`, async () => {
    const responses = [];
    for (let index = 0; index < OBJECT_LOGIN_REQUESTS; index += 1) {
      responses.push(
        await timed(() =>
          postJson(probe, "/api/__probe/object/login", { email: ADMIN_EMAIL, password }),
        ),
      );
    }

    results.objectLogins = {
      caller: summarize(
        responses,
        await eventsFor("/api/__probe/object/login", OBJECT_LOGIN_REQUESTS),
      ),
      object: summarize([], await eventsFor("/login", OBJECT_LOGIN_REQUESTS)),
      errors: responses
        .filter(({ status }) => status !== 200)
        .map(({ body }) => body.slice(0, 200)),
    };
    if (IS_LOCAL) {
      expect(responses.map(({ status }) => status)).toEqual(
        Array.from({ length: OBJECT_LOGIN_REQUESTS }, () => 200),
      );
    }
  });

  it("stores 95 MB through the Worker and returns the same bytes", async () => {
    const content = randomBytes(UPLOAD_BYTES);
    const written = await timed(() =>
      authenticated("/api/__probe/store/files/upload-95.bin", { method: "PUT", body: content }),
    );
    const write = {
      status: written.status,
      response: written.body.slice(0, 300),
      clientMs: Math.round(written.clientMs),
      caller: summarize([], await eventsWithPrefix("/api/__probe/store/files/upload-95.bin", 1)),
      object: summarize([], await eventsWithPrefix("/files/upload-95.bin", 1)),
    };
    results.upload95 = { write };
    expect(written.status, written.body.slice(0, 300)).toBe(200);

    const started = performance.now();
    const read = await authenticated("/api/__probe/store/files/upload-95.bin");
    const bytes = new Uint8Array(await read.arrayBuffer());
    const clientMs = Math.round(performance.now() - started);

    results.upload95 = { write, read: { status: read.status, bytes: bytes.byteLength, clientMs } };
    expect(bytes.byteLength).toBe(UPLOAD_BYTES);
    expect(sha256(bytes)).toBe(sha256(content));
  });

  it.skipIf(!IS_DEPLOYED)("rejects 105 MB with 413", () => {
    // curl keeps reading the response when the server answers before the upload ends, which fetch does not.
    const directory = mkdtempSync(join(tmpdir(), "davloom-oversized-"));
    try {
      const file = join(directory, "oversized.bin");
      writeFileSync(file, "");
      truncateSync(file, OVERSIZED_BYTES);
      const { stdout } = spawnSync(
        "curl",
        [
          "--silent",
          "--output",
          "/dev/null",
          "--write-out",
          "%{http_code}",
          "--request",
          "PUT",
          "--data-binary",
          `@${file}`,
          "--header",
          `${PROBE_TOKEN_HEADER}: ${token}`,
          "--header",
          `authorization: ${authorization.authorization}`,
          `${baseUrl}/api/__probe/store/files/upload-105.bin`,
        ],
        { encoding: "utf8" },
      );

      results.upload105 = { bytes: OVERSIZED_BYTES, status: Number(stdout) };
      expect(Number(stdout)).toBe(413);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("copies and deletes objects in one authenticated request", async () => {
    const total = CHURN_STEPS.reduce((sum, count) => sum + count, 0);
    const seed = await timed(() =>
      postJson(authenticated, "/api/__probe/store/directories/seed", {
        parent: "/churn/a",
        count: total,
        bytes: OBJECT_SIZE_BYTES,
      }),
    );
    expect(seed.status, seed.body.slice(0, 200)).toBe(200);

    const steps: unknown[] = [];
    for (const count of CHURN_STEPS) {
      const seen =
        tail?.events.filter((event) => pathOf(event.url) === "/directories/churn").length ?? 0;
      const churn = await timed(() =>
        postJson(authenticated, "/api/__probe/store/directories/churn", {
          from: "/churn/a",
          to: "/churn/b",
          count,
        }),
      );
      const events = await eventsFor("/directories/churn", seen + 1);
      steps.push({
        objects: count,
        status: churn.status,
        clientMs: Math.round(churn.clientMs),
        cpuMs: events.at(-1)?.cpuTime ?? null,
        outcome: events.at(-1)?.outcome ?? null,
        response: churn.body.slice(0, 200),
      });
      if (churn.status !== 200) {
        break;
      }
    }

    results.directoryChurn = { seed: JSON.parse(seed.body), objectBytes: OBJECT_SIZE_BYTES, steps };
    if (IS_LOCAL) {
      expect(steps).toHaveLength(CHURN_STEPS.length);
    }
  });

  it("reports the rows read and written by a directory PROPFIND", async () => {
    const seed = await postJson(authenticated, "/api/__probe/store/directories/seed", {
      parent: "/listing",
      count: LISTING_CHILDREN,
      bytes: OBJECT_SIZE_BYTES,
    });
    expect(seed.status).toBe(200);

    const first = await timed(() =>
      authenticated("/api/__probe/quota/dav/listing", { method: "PROPFIND" }),
    );
    const second = await timed(() =>
      authenticated("/api/__probe/quota/dav/listing", { method: "PROPFIND" }),
    );
    expect(first.status, first.body.slice(0, 200)).toBe(200);

    results.directoryPropfind = {
      children: LISTING_CHILDREN,
      first: JSON.parse(first.body),
      second: JSON.parse(second.body),
      caller: summarize([first, second], await eventsFor("/api/__probe/quota/dav/listing", 2)),
    };
    expect(JSON.parse(first.body)).toMatchObject({ children: LISTING_CHILDREN });
  });

  /**
   * Works up through CPU targets until a request fails. The next iteration count comes from the rate
   * measured so far, because the speed of the loop changes as the JIT warms up.
   */
  const rampCpu = async (
    routePrefix: string,
    tailPrefix: string,
    targetsMs: readonly number[],
    attemptsPerTarget: (targetMs: number) => number,
  ) => {
    let iterationsPerMs = 0;
    let lastSuccessfulCpuMs: number | null = null;
    const steps: unknown[] = [];
    let burnNumber = 0;
    let tailSeesRoute = true;

    for (const targetMs of targetsMs) {
      const iterations =
        iterationsPerMs > 0 ? Math.ceil(targetMs * iterationsPerMs) : FIRST_BURN_ITERATIONS;
      let failed = false;
      for (let attempt = 0; attempt < attemptsPerTarget(targetMs); attempt += 1) {
        // A unique iteration count lets each request be found again in the tail.
        const count = iterations + burnNumber;
        burnNumber += 1;
        const response = await timed(() => probe(`${routePrefix}/${count}`, { method: "POST" }));
        // Without a CPU figure, the client's time stands in: the loop does nothing but spend CPU.
        const [event] = await eventsFor(`${tailPrefix}/${count}`, 1, tailSeesRoute ? 15_000 : 0);
        tailSeesRoute = Boolean(event);
        const measuredMs = event?.cpuTime || response.clientMs;
        if (response.status === 200 && measuredMs >= 2) {
          iterationsPerMs = count / measuredMs;
          lastSuccessfulCpuMs = measuredMs;
        }
        steps.push({
          targetMs,
          iterations: count,
          status: response.status,
          clientMs: Math.round(response.clientMs),
          cpuMs: event?.cpuTime ?? null,
          wallMs: event?.wallTime ?? null,
          outcome: event?.outcome ?? null,
          exceptions: event?.exceptions ?? [],
          error: response.status === 200 ? null : response.body.slice(0, 300),
        });
        failed ||= response.status !== 200;
      }
      if (failed) {
        break;
      }
    }
    return { lastSuccessfulCpuMs, steps };
  };

  it("finds how much CPU one Worker request gets", async () => {
    results.workerCpu = await rampCpu(
      "/api/__probe/burn",
      "/api/__probe/burn",
      IS_DEPLOYED ? WORKER_CPU_TARGETS_MS : [5, 50],
      () => CPU_ATTEMPTS_PER_TARGET,
    );
  });

  it("finds how much CPU one Durable Object request gets", async () => {
    results.objectCpu = await rampCpu(
      "/api/__probe/object/burn",
      "/burn",
      OBJECT_CPU_TARGETS_MS,
      // The long steps are expensive, and one result each is enough to see where the limit is.
      (targetMs) => (targetMs < 1000 ? CPU_ATTEMPTS_PER_TARGET : 1),
    );
    expect(results.objectCpu).toMatchObject({ lastSuccessfulCpuMs: expect.any(Number) });
  });
});

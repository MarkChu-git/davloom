import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OFFLINE_VARS, SECRET, startDavloom, stringField, type Davloom } from "../http/davloom";
import { startWorkerdServer } from "../http/servers";
import { USAGE_PATH, type Usage } from "./usage";

// The Cloud Free quota check on the production request path (PRD §11): the production Worker runs
// in local workerd with its D1 binding, its storage namespace and fetch metered (entry.workers.ts),
// and each request below must stay within the Free plan's limits per invocation, within a budget
// measured on 2026-11-24, and, as part of a modeled day, within the plan's daily quotas.

/** Workers Free, per invocation (PRD §9): D1 queries, internal and external subrequests. */
const PER_INVOCATION = { d1Queries: 50, internalSubrequests: 1000, externalSubrequests: 50 };

/** Workers Free, per day (PRD §9). Durable Object requests include every call on a stub. */
const PER_DAY = {
  workerRequests: 100_000,
  d1RowsRead: 5_000_000,
  d1RowsWritten: 100_000,
  objectRequests: 100_000,
  objectRowsRead: 5_000_000,
  objectRowsWritten: 100_000,
} as const;
type DailyQuota = keyof typeof PER_DAY;
const DAILY_QUOTAS: readonly DailyQuota[] = [
  "workerRequests",
  "d1RowsRead",
  "d1RowsWritten",
  "objectRequests",
  "objectRowsRead",
  "objectRowsWritten",
];

const RESULTS_FILE = resolve(import.meta.dirname, "../test-results/quota/results.json");

const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';
const PROPPATCH_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:davloom:quota"><D:set><D:prop><Z:color>blue</Z:color></D:prop></D:set></D:propertyupdate>';

interface Context {
  readonly davloom: Davloom;
  /** A collection of this row's own under the Mount, created before the row runs. */
  readonly base: string;
  /** What `setup` handed on, such as a lock token. */
  readonly state: Record<string, string>;
}

interface Row {
  readonly name: string;
  readonly setup?: (context: Context) => Promise<void>;
  readonly request: (context: Context) => Promise<Response>;
  readonly status: number;
  /** The most the request may cost; measured on 2026-11-24, so a regression fails. */
  readonly budget: Usage;
}

const budget = (values: Partial<Usage>): Usage => ({
  d1Queries: 0,
  d1Calls: 0,
  d1RowsRead: 0,
  d1RowsWritten: 0,
  objectCalls: 0,
  objectRowsRead: 0,
  objectRowsWritten: 0,
  externalFetches: 0,
  ...values,
});

const put = async ({ davloom }: Context, path: string, body = "hello") => {
  const response = await davloom.dav(path, { method: "PUT", body });
  if (response.status !== 201 && response.status !== 204)
    throw new Error(`PUT ${path} answered ${response.status}`);
};

const lock = async ({ davloom }: Context, path: string) =>
  await davloom.dav(path, {
    method: "LOCK",
    headers: { "content-type": "application/xml", timeout: "Second-600" },
    body: LOCK_BODY,
  });

const destination = ({ davloom }: Context, path: string) => ({
  destination: `${davloom.server.url}/dav${path}`,
});

const BIG = 1024 * 1024 * 3 + 5;

const ROWS: readonly Row[] = [
  {
    name: "OPTIONS on a collection",
    request: ({ davloom, base }) => davloom.dav(base, { method: "OPTIONS" }),
    status: 200,
    budget: budget({}),
  },
  {
    name: "PROPFIND depth 0 on the Mount",
    request: ({ davloom }) =>
      davloom.dav("/files", { method: "PROPFIND", headers: { depth: "0" } }),
    status: 207,
    budget: budget({ d1Queries: 1, d1Calls: 1, d1RowsRead: 2, objectCalls: 2, objectRowsRead: 1 }),
  },
  {
    name: "PROPFIND depth 1 on the root",
    request: ({ davloom }) => davloom.dav("/", { method: "PROPFIND", headers: { depth: "1" } }),
    status: 207,
    budget: budget({ d1Queries: 1, d1Calls: 1, d1RowsRead: 1, objectCalls: 2, objectRowsRead: 1 }),
  },
  {
    name: "PROPFIND depth 1 on a collection of 20 files",
    setup: async (context) => {
      for (let index = 0; index < 20; index += 1) await put(context, `${context.base}/f${index}`);
    },
    request: ({ davloom, base }) =>
      davloom.dav(base, { method: "PROPFIND", headers: { depth: "1" } }),
    status: 207,
    budget: budget({ d1Queries: 1, d1Calls: 1, d1RowsRead: 4, objectCalls: 3, objectRowsRead: 63 }),
  },
  {
    name: "GET a small file",
    setup: (context) => put(context, `${context.base}/a.txt`),
    request: ({ davloom, base }) => davloom.dav(`${base}/a.txt`),
    status: 200,
    budget: budget({ objectCalls: 2, objectRowsRead: 5 }),
  },
  {
    name: "GET a file of 3 MiB",
    setup: (context) => put(context, `${context.base}/big.bin`, "x".repeat(BIG)),
    request: ({ davloom, base }) => davloom.dav(`${base}/big.bin`),
    status: 200,
    budget: budget({ objectCalls: 2, objectRowsRead: 8 }),
  },
  {
    name: "HEAD a file",
    setup: (context) => put(context, `${context.base}/a.txt`),
    request: ({ davloom, base }) => davloom.dav(`${base}/a.txt`, { method: "HEAD" }),
    status: 200,
    budget: budget({ objectCalls: 1, objectRowsRead: 2 }),
  },
  {
    name: "PUT a new small file",
    request: ({ davloom, base }) => davloom.dav(`${base}/new.txt`, { method: "PUT", body: "hi" }),
    status: 201,
    budget: budget({
      d1Queries: 2,
      d1Calls: 2,
      d1RowsRead: 7,
      objectCalls: 2,
      objectRowsRead: 13,
      objectRowsWritten: 10,
    }),
  },
  {
    name: "PUT over a file",
    setup: (context) => put(context, `${context.base}/a.txt`),
    request: ({ davloom, base }) =>
      davloom.dav(`${base}/a.txt`, { method: "PUT", body: "replaced" }),
    status: 204,
    budget: budget({
      d1Queries: 1,
      d1Calls: 1,
      d1RowsRead: 4,
      objectCalls: 2,
      objectRowsRead: 18,
      objectRowsWritten: 9,
    }),
  },
  {
    name: "PUT a new file of 3 MiB",
    request: ({ davloom, base }) =>
      davloom.dav(`${base}/big.bin`, { method: "PUT", body: "y".repeat(BIG) }),
    status: 201,
    budget: budget({
      d1Queries: 2,
      d1Calls: 2,
      d1RowsRead: 7,
      objectCalls: 2,
      objectRowsRead: 13,
      objectRowsWritten: 16,
    }),
  },
  {
    name: "MKCOL",
    request: ({ davloom, base }) => davloom.dav(`${base}/sub`, { method: "MKCOL" }),
    status: 201,
    budget: budget({
      d1Queries: 2,
      d1Calls: 2,
      d1RowsRead: 7,
      objectCalls: 1,
      objectRowsRead: 6,
      objectRowsWritten: 5,
    }),
  },
  {
    name: "PROPPATCH a file",
    setup: (context) => put(context, `${context.base}/a.txt`),
    request: ({ davloom, base }) =>
      davloom.dav(`${base}/a.txt`, {
        method: "PROPPATCH",
        headers: { "content-type": "application/xml" },
        body: PROPPATCH_BODY,
      }),
    status: 207,
    budget: budget({
      d1Queries: 1,
      d1Calls: 1,
      d1RowsRead: 4,
      objectCalls: 2,
      objectRowsRead: 4,
      objectRowsWritten: 2,
    }),
  },
  {
    name: "COPY a file",
    setup: (context) => put(context, `${context.base}/a.txt`),
    request: (context) =>
      context.davloom.dav(`${context.base}/a.txt`, {
        method: "COPY",
        headers: destination(context, `${context.base}/b.txt`),
      }),
    status: 201,
    budget: budget({
      d1Queries: 2,
      d1Calls: 2,
      d1RowsRead: 8,
      objectCalls: 2,
      objectRowsRead: 18,
      objectRowsWritten: 8,
    }),
  },
  {
    name: "COPY a collection of 20 files",
    setup: async (context) => {
      await context.davloom.dav(`${context.base}/src`, { method: "MKCOL" });
      for (let index = 0; index < 20; index += 1)
        await put(context, `${context.base}/src/f${index}`);
    },
    request: (context) =>
      context.davloom.dav(`${context.base}/src`, {
        method: "COPY",
        headers: destination(context, `${context.base}/dst`),
      }),
    status: 201,
    budget: budget({
      d1Queries: 2,
      d1Calls: 2,
      d1RowsRead: 8,
      objectCalls: 2,
      objectRowsRead: 234,
      objectRowsWritten: 125,
    }),
  },
  {
    name: "MOVE a file",
    setup: (context) => put(context, `${context.base}/a.txt`),
    request: (context) =>
      context.davloom.dav(`${context.base}/a.txt`, {
        method: "MOVE",
        headers: destination(context, `${context.base}/moved.txt`),
      }),
    status: 201,
    budget: budget({
      d1Queries: 5,
      d1Calls: 5,
      d1RowsRead: 17,
      objectCalls: 2,
      objectRowsRead: 9,
      objectRowsWritten: 4,
    }),
  },
  {
    name: "MOVE a collection of 20 files",
    setup: async (context) => {
      await context.davloom.dav(`${context.base}/src`, { method: "MKCOL" });
      for (let index = 0; index < 20; index += 1)
        await put(context, `${context.base}/src/f${index}`);
    },
    request: (context) =>
      context.davloom.dav(`${context.base}/src`, {
        method: "MOVE",
        headers: destination(context, `${context.base}/dst`),
      }),
    status: 201,
    budget: budget({
      d1Queries: 5,
      d1Calls: 5,
      d1RowsRead: 17,
      objectCalls: 2,
      objectRowsRead: 9,
      objectRowsWritten: 4,
    }),
  },
  {
    name: "DELETE a file",
    setup: (context) => put(context, `${context.base}/a.txt`),
    request: ({ davloom, base }) => davloom.dav(`${base}/a.txt`, { method: "DELETE" }),
    status: 204,
    budget: budget({
      d1Queries: 3,
      d1Calls: 3,
      d1RowsRead: 9,
      objectCalls: 2,
      objectRowsRead: 15,
      objectRowsWritten: 4,
    }),
  },
  {
    name: "LOCK a file",
    setup: (context) => put(context, `${context.base}/a.txt`),
    request: (context) => lock(context, `${context.base}/a.txt`),
    status: 200,
    budget: budget({
      d1Queries: 2,
      d1Calls: 2,
      d1RowsRead: 11,
      d1RowsWritten: 3,
      objectCalls: 1,
      objectRowsRead: 2,
    }),
  },
  {
    name: "UNLOCK a file",
    setup: async (context) => {
      await put(context, `${context.base}/a.txt`);
      const locked = await lock(context, `${context.base}/a.txt`);
      context.state.token = locked.headers.get("lock-token") ?? "";
    },
    request: ({ davloom, base, state }) =>
      davloom.dav(`${base}/a.txt`, {
        method: "UNLOCK",
        headers: { "lock-token": state.token ?? "" },
      }),
    status: 204,
    budget: budget({ d1Queries: 2, d1Calls: 2, d1RowsRead: 7, d1RowsWritten: 1 }),
  },
  {
    name: "PUT to a locked file with its lock token",
    setup: async (context) => {
      await put(context, `${context.base}/a.txt`);
      const locked = await lock(context, `${context.base}/a.txt`);
      context.state.token = locked.headers.get("lock-token") ?? "";
    },
    request: ({ davloom, base, state }) =>
      davloom.dav(`${base}/a.txt`, {
        method: "PUT",
        headers: { if: `(${state.token ?? ""})` },
        body: "locked",
      }),
    status: 204,
    budget: budget({
      d1Queries: 2,
      d1Calls: 2,
      d1RowsRead: 10,
      objectCalls: 3,
      objectRowsRead: 20,
      objectRowsWritten: 9,
    }),
  },
  {
    name: "GET /api/me",
    request: ({ davloom }) => davloom.api("/api/me"),
    status: 200,
    budget: budget({ d1Queries: 2, d1Calls: 2, d1RowsRead: 2 }),
  },
  {
    name: "GET /api/overview",
    request: ({ davloom }) => davloom.api("/api/overview"),
    status: 200,
    budget: budget({
      d1Queries: 6,
      d1Calls: 6,
      d1RowsRead: 10,
      objectCalls: 3,
      objectRowsRead: 3,
    }),
  },
  {
    name: "GET /api/keys",
    request: ({ davloom }) => davloom.api("/api/keys"),
    status: 200,
    budget: budget({ d1Queries: 3, d1Calls: 3, d1RowsRead: 6 }),
  },
  {
    name: "POST /api/keys",
    request: ({ davloom }) =>
      davloom.api("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: "quota", access: "read-only" }),
      }),
    status: 201,
    // Two of the queries read the session and its user for the step-up check (verification.ts).
    budget: budget({ d1Queries: 5, d1Calls: 5, d1RowsRead: 5, d1RowsWritten: 5 }),
  },
  {
    name: "DELETE /api/keys/:id",
    setup: async ({ davloom, state }) => {
      const created = await davloom.api("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: "to delete", access: "read-only" }),
      });
      state.id = stringField(await created.json(), "id");
    },
    request: ({ davloom, state }) =>
      davloom.api(`/api/keys/${state.id ?? ""}`, { method: "DELETE" }),
    status: 200,
    // Two of the queries read the session and its user for the step-up check (verification.ts).
    budget: budget({ d1Queries: 5, d1Calls: 5, d1RowsRead: 6, d1RowsWritten: 1 }),
  },
  {
    name: "GET /api/mounts",
    request: ({ davloom }) => davloom.api("/api/mounts"),
    status: 200,
    budget: budget({ d1Queries: 3, d1Calls: 3, d1RowsRead: 4 }),
  },
  {
    name: "GET /api/backends",
    request: ({ davloom }) => davloom.api("/api/backends"),
    status: 200,
    budget: budget({
      d1Queries: 3,
      d1Calls: 3,
      d1RowsRead: 4,
      objectCalls: 2,
      objectRowsRead: 2,
    }),
  },
  {
    name: "GET /api/health",
    request: ({ davloom }) => davloom.server.fetch("/api/health"),
    status: 200,
    budget: budget({}),
  },
];

const measured: Record<string, Usage> = {};
const modeled: { day?: Record<string, number>; users?: Record<string, number> } = {};

/** The first request of an API Key, when the Worker has not cached it: 30 s after its last. */
const COLD_KEY = {
  name: "PROPFIND depth 0 with an API Key not yet cached",
  budget: budget({
    d1Queries: 3,
    d1Calls: 3,
    d1RowsRead: 4,
    d1RowsWritten: 1,
    objectCalls: 2,
    objectRowsRead: 1,
  }),
};

/** Collection sizes around the Free plan's 50 D1 queries per request. */
const SIZES = [1, 49, 51, 120] as const;
let davloom: Davloom;

const usageOf = async (): Promise<Usage> => {
  const response = await davloom.server.fetch(USAGE_PATH);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the metered Worker's own report
  return (await response.json()) as Usage;
};

const internalSubrequests = (usage: Usage) => usage.d1Calls + usage.objectCalls;

beforeAll(async () => {
  davloom = await startDavloom(() =>
    startWorkerdServer("tests/integration/compat/quota/wrangler.jsonc", {
      vars: { DAVLOOM_SECRET: SECRET, ...OFFLINE_VARS },
    }),
  );
});

afterAll(async () => {
  mkdirSync(resolve(RESULTS_FILE, ".."), { recursive: true });
  writeFileSync(RESULTS_FILE, `${JSON.stringify({ measured, ...modeled }, null, 2)}\n`);
  await davloom?.server.stop();
});

/** Runs a request, reads its whole body, and gives its status with what it cost. */
const measure = async (request: () => Promise<Response>) => {
  const response = await request();
  await response.arrayBuffer();
  return { status: response.status, usage: await usageOf() };
};

/** Fills the API Key and Mount caches, which hold for 30 seconds. */
const warm = async () => {
  await measure(() => davloom.dav("/", { method: "PROPFIND", headers: { depth: "0" } }));
};

const expectWithinFree = (usage: Usage) => {
  expect(usage.d1Queries, "D1 queries").toBeLessThanOrEqual(PER_INVOCATION.d1Queries);
  expect(internalSubrequests(usage), "internal subrequests").toBeLessThanOrEqual(
    PER_INVOCATION.internalSubrequests,
  );
  expect(usage.externalFetches, "external subrequests").toBeLessThanOrEqual(
    PER_INVOCATION.externalSubrequests,
  );
};

const expectWithin = (usage: Usage, most: Usage) => {
  for (const [metric, value] of Object.entries(most)) {
    expect(Reflect.get(usage, metric), metric).toBeLessThanOrEqual(value);
  }
};

describe("what one request costs", () => {
  it.each(ROWS.map((row, index) => [row.name, row, index] as const))(
    "%s",
    async (_, row, index) => {
      const context: Context = { davloom, base: `/files/quota-${index}`, state: {} };
      expect((await davloom.dav(context.base, { method: "MKCOL" })).status).toBe(201);
      await row.setup?.(context);
      // Warm, as every request is but a client's first in 30 seconds, which COLD_KEY measures.
      await warm();
      const { status, usage } = await measure(() => row.request(context));
      measured[row.name] = usage;

      expect(status).toBe(row.status);
      expectWithinFree(usage);
      expectWithin(usage, row.budget);
    },
  );

  it(COLD_KEY.name, async () => {
    const created = await davloom.api("/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "cold", access: "read-write" }),
    });
    const key = stringField(await created.json(), "key");
    const { status, usage } = await measure(() =>
      davloom.dav("/files", { key, method: "PROPFIND", headers: { depth: "0" } }),
    );
    measured[COLD_KEY.name] = usage;

    expect(status).toBe(207);
    expectWithinFree(usage);
    expectWithin(usage, COLD_KEY.budget);
  });
});

/** A collection of `files` small files. */
const filled = async (base: string, files: number) => {
  await davloom.dav(base, { method: "MKCOL" });
  await Promise.all(
    Array.from({ length: files }, (_, index) =>
      davloom.dav(`${base}/f${index}`, { method: "PUT", body: "x" }),
    ),
  );
};

// What must not grow with the size of a collection: before 2026-11-24 a listing read the locks of
// each entry with a query of its own, so a collection of 50 entries passed the Free plan's limit.
describe("costs that stay flat as a collection grows", () => {
  it.each(SIZES)("PROPFIND depth 1 on a collection of %i files", async (files) => {
    const base = `/files/flat-propfind-${files}`;
    await filled(base, files);
    await warm();
    const { status, usage } = await measure(() =>
      davloom.dav(base, { method: "PROPFIND", headers: { depth: "1" } }),
    );

    expect(status).toBe(207);
    expectWithinFree(usage);
    expect(usage).toMatchObject({ d1Queries: 1, objectCalls: 3 });
    // The object reads the collection's rows and each entry's row, properties and parent.
    expect(usage.objectRowsRead).toBeLessThanOrEqual(3 * files + 3);
  });

  it.each(SIZES)("COPY of a collection of %i files", async (files) => {
    const base = `/files/flat-copy-${files}`;
    await filled(base, files);
    await warm();
    const { status, usage } = await measure(() =>
      davloom.dav(base, {
        method: "COPY",
        headers: { destination: `${davloom.server.url}/dav${base}-copy` },
      }),
    );

    expect(status).toBe(201);
    expectWithinFree(usage);
    expect(usage).toMatchObject({ d1Queries: 2, objectCalls: 2 });
    // Each file writes its entry, its chunk and the content counter; the copy writes its root and
    // the usage totals.
    expect(usage.objectRowsWritten).toBeLessThanOrEqual(6 * files + 5);
  });

  it.each(SIZES)("MOVE of a collection of %i files", async (files) => {
    const base = `/files/flat-move-${files}`;
    await filled(base, files);
    await warm();
    const { status, usage } = await measure(() =>
      davloom.dav(base, {
        method: "MOVE",
        headers: { destination: `${davloom.server.url}/dav${base}-moved` },
      }),
    );

    expect(status).toBe(201);
    expectWithinFree(usage);
    // A move renames one row, however large the collection.
    expect(usage).toMatchObject({ d1Queries: 5, objectCalls: 2, objectRowsWritten: 4 });
  });

  // Before 2026-11-24 the usage counted every entry row of the backend on each Dashboard visit.
  it.each(SIZES)(
    "GET /api/overview and /api/backends with %i more files in the backend",
    async (files) => {
      await filled(`/files/flat-usage-${files}`, files);
      for (const [path, most] of [
        ["/api/overview", 3],
        ["/api/backends", 2],
      ] as const) {
        const { status, usage } = await measure(() => davloom.api(path));
        expect(status).toBe(200);
        expectWithinFree(usage);
        // The totals row once per usage or quota, however many entries the backend holds.
        expect(usage.objectRowsRead, path).toBeLessThanOrEqual(most);
      }
    },
  );
});

/**
 * A modeled day of one active user: a sync client that checks a folder every minute for 12 hours,
 * with the API Key cache cold at each check, edits a few hundred files, and opens the Dashboard
 * now and then. Counts are requests per day.
 */
const MODEL_DAY: readonly (readonly [string, number])[] = [
  [COLD_KEY.name, 720],
  ["PROPFIND depth 1 on a collection of 20 files", 720],
  ["PROPFIND depth 0 on the Mount", 720],
  ["PROPFIND depth 1 on the root", 50],
  ["OPTIONS on a collection", 50],
  ["GET a small file", 200],
  ["GET a file of 3 MiB", 50],
  ["HEAD a file", 100],
  ["PUT a new small file", 100],
  ["PUT over a file", 100],
  ["PUT a new file of 3 MiB", 20],
  ["MKCOL", 10],
  ["PROPPATCH a file", 50],
  ["COPY a file", 10],
  ["COPY a collection of 20 files", 2],
  ["MOVE a file", 20],
  ["MOVE a collection of 20 files", 2],
  ["DELETE a file", 20],
  ["LOCK a file", 100],
  ["UNLOCK a file", 100],
  ["PUT to a locked file with its lock token", 100],
  ["GET /api/me", 20],
  ["GET /api/overview", 20],
  ["GET /api/keys", 5],
  ["POST /api/keys", 1],
  ["DELETE /api/keys/:id", 1],
  ["GET /api/mounts", 5],
  ["GET /api/backends", 5],
];

/** The users whose modeled days the Free plan's daily quotas must hold at once. */
const MODEL_USERS = 10;

const dailyCost = (usage: Usage): Record<DailyQuota, number> => ({
  workerRequests: 1,
  d1RowsRead: usage.d1RowsRead,
  d1RowsWritten: usage.d1RowsWritten,
  objectRequests: usage.objectCalls,
  objectRowsRead: usage.objectRowsRead,
  objectRowsWritten: usage.objectRowsWritten,
});

describe("the daily quotas", () => {
  it("names only measured requests in the modeled day", () => {
    const names = new Set([...ROWS.map((row) => row.name), COLD_KEY.name]);
    expect(MODEL_DAY.map(([name]) => name).filter((name) => !names.has(name))).toEqual([]);
  });

  it(`hold the modeled days of ${MODEL_USERS} users`, () => {
    const day = Object.fromEntries(
      DAILY_QUOTAS.map((quota) => [
        quota,
        MODEL_DAY.reduce((sum, [name, count]) => {
          const usage = measured[name];
          if (!usage) throw new Error(`"${name}" was not measured; run the whole file`);
          return sum + dailyCost(usage)[quota] * count;
        }, 0),
      ]),
    );
    const users = Object.fromEntries(
      DAILY_QUOTAS.map((quota) => [
        quota,
        Math.floor(PER_DAY[quota] / Math.max(1, day[quota] ?? 0)),
      ]),
    );
    modeled.day = day;
    modeled.users = users;

    for (const [quota, fits] of Object.entries(users)) {
      expect(fits, `users whose modeled day fits in ${quota}`).toBeGreaterThanOrEqual(MODEL_USERS);
    }
  });
});

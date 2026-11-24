import { createMemoryPropertyStore } from "@davloom/core";
import { snapshot, storageContract } from "@davloom/core/testing";
import { createObjectStoreStorage } from "@davloom/storage/object-store";
import { createS3Client, createS3Driver } from "@davloom/storage/s3";
import { afterAll, describe, expect, it } from "vitest";
import { startS3Proxy, type FaultRule } from "./s3-proxy";
import { driverView } from "./s3-targets";
import { FAULT_MODES } from "./s3-world";

// The proxy of s3-proxy.ts on its own: its in-memory S3 against the S3 driver of packages/storage
// (the storage contract, with listings of a few keys per page, and the keys S3 allows), its rules,
// and what the driver reports for each fault the tables inject.

const proxy = startS3Proxy({ pageSize: 2 });
afterAll(async () => {
  await proxy.stop();
});

const client = createS3Client({
  endpoint: proxy.url,
  region: "us-east-1",
  bucket: "unused",
  forcePathStyle: true,
  accessKeyId: "proxy",
  secretAccessKey: "proxy-secret",
});

let buckets = 0;
const fresh = () => {
  buckets += 1;
  const bucket = `contract-${buckets}`;
  return { bucket, driver: createS3Driver({ client, bucket }) };
};
const storageOf = (prefix = "") =>
  createObjectStoreStorage({
    driver: fresh().driver,
    prefix,
    properties: createMemoryPropertyStore(),
  });

storageContract("object store, S3 driver on the proxy's in-memory S3", {
  make: () => storageOf(),
  runs: 25,
});
storageContract("object store, S3 driver on the proxy's in-memory S3, with a key prefix", {
  make: () => storageOf("tenant/"),
  runs: 10,
});

const text = (value: string) => new Blob([value]).stream();
const length = (value: string) => new TextEncoder().encode(value).byteLength;

describe("the in-memory S3", () => {
  it.each([
    ["CJK", "中文文件.txt"],
    ["emoji", "😀 smile.txt"],
    ["percent", "100% done.txt"],
    ["plus", "a+b=c.txt"],
    ["spaces", "  two  spaces  "],
    ["hash", "#1 issue.txt"],
    ["query and ampersand", "q?a=1&b=2"],
    ["XML characters", `<tag a="b">'&'<\\tag>`],
    ["a control character", "bell\u0007.txt"],
  ])("keeps a name with %s through write, list, copy, move and read", async (_, name) => {
    const storage = storageOf();
    expect((await storage.createCollection([name])).ok).toBe(true);
    expect((await storage.write([name, name], text(name), { size: length(name) })).ok).toBe(true);
    expect((await storage.copy([name], ["copy"], { overwrite: false, shallow: false })).ok).toBe(
      true,
    );
    expect((await storage.move([name, name], [name, "moved"], { overwrite: false })).ok).toBe(true);
    expect(await snapshot(storage)).toEqual({
      [`${name}/`]: "",
      [`${name}/moved`]: name,
      "copy/": "",
      [`copy/${name}`]: name,
    });
  });

  it.each([1, 2, 3, 5, 1000])("pages a listing of 23 keys %i at a time", async (pageSize) => {
    const { bucket, driver } = fresh();
    const memory = proxy.memory;
    if (!memory) throw new Error("no in-memory store");
    const keys = [
      ...Array.from({ length: 20 }, (_, index) => `dir/k${String(index).padStart(2, "0")}`),
      "dir/sub/a",
      "dir/sub/b",
      "dir/",
    ];
    for (const key of keys) memory.put(bucket, key, key);
    const before = memory.pageSize;
    memory.pageSize = pageSize;
    try {
      const listAll = async (recursive: boolean) => {
        const objects: string[] = [];
        const prefixes: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const page = await driver.list("dir/", { recursive, cursor });
          if (!page.ok) throw new Error(page.failure);
          expect(page.value.objects.length + page.value.prefixes.length).toBeLessThanOrEqual(
            pageSize,
          );
          objects.push(...page.value.objects.map((object) => object.key));
          prefixes.push(...page.value.prefixes);
          cursor = page.value.cursor;
          pages += 1;
        } while (cursor !== null);
        return { objects, prefixes, pages };
      };
      const deep = await listAll(true);
      expect(deep.objects).toEqual(keys.toSorted());
      expect(deep.pages).toBe(Math.max(1, Math.ceil(keys.length / pageSize)));
      const level = await listAll(false);
      expect(level.objects).toEqual(keys.filter((key) => !key.startsWith("dir/sub/")).toSorted());
      expect(level.prefixes).toEqual(["dir/sub/"]);
    } finally {
      memory.pageSize = before;
    }
  });

  it("serves a range, and refuses one past the end", async () => {
    const { driver } = fresh();
    expect((await driver.put("f", text("0123456789"), { length: 10, created: 1 })).ok).toBe(true);
    const part = await driver.get("f", { start: 2, stop: 5 });
    if (!part.ok || !part.value) throw new Error("no range");
    expect(part.value.info.size).toBe(10);
    expect(await new Response(part.value.body).text()).toBe("234");
    const head = await driver.head("f");
    expect(head.ok && head.value?.size).toBe(10);
    expect((await driver.get("f", { start: 20, stop: 30 })).ok).toBe(false);
  });

  it("refuses a create-only put of a key that exists", async () => {
    const { driver } = fresh();
    expect((await driver.put("f", null, { length: 0, created: 1, ifNoneMatch: true })).ok).toBe(
      true,
    );
    expect(await driver.put("f", null, { length: 0, created: 1, ifNoneMatch: true })).toEqual({
      ok: false,
      failure: "exists",
    });
  });

  it("assembles an upload of unknown length in parts", async () => {
    const { driver } = fresh();
    const part = new Uint8Array(5 * 1024 * 1024).fill(7);
    const body = new Blob([part, part, new Uint8Array([1, 2, 3])]).stream();
    expect((await driver.put("big", body, { created: 1 })).ok).toBe(true);
    const head = await driver.head("big");
    expect(head.ok && head.value?.size).toBe(10 * 1024 * 1024 + 3);
  });
});

describe("the proxy's rules", () => {
  const { bucket, driver } = fresh();
  const seed = async () => {
    for (const key of ["a", "b", "c", "d", "e"]) {
      expect((await driver.put(key, text(key), { length: 1, created: 1 })).ok).toBe(true);
    }
  };
  const forbidden = { kind: "status", status: 403, body: "xml", code: "AccessDenied" } as const;
  const run = async (rules: FaultRule[]) => {
    proxy.setRules(rules);
    const results = {
      head: (await driver.head("a")).ok,
      list: (await driver.list("", { recursive: true, limit: 2 })).ok,
      later: (await driver.list("", { recursive: true, cursor: "WyJiIixmYWxzZV0=" })).ok,
      get: (await driver.get("b")).ok,
      copy: (await driver.copy("c", "c2")).ok,
      delete: (await driver.delete(["zz"])).ok,
    };
    proxy.setRules([]);
    return results;
  };

  it.each([
    ["no rule", [], {}],
    [
      "every request",
      [{ fault: forbidden }],
      { head: false, list: false, later: false, get: false, copy: false, delete: false },
    ],
    ["a method", [{ method: "HEAD", fault: forbidden }], { head: false }],
    [
      "a query parameter",
      [{ query: ["list-type"], fault: forbidden }],
      { list: false, later: false },
    ],
    ["later pages", [{ query: ["continuation-token"], fault: forbidden }], { later: false }],
    ["a header", [{ header: "x-amz-copy-source", fault: forbidden }], { copy: false }],
    ["a key", [{ key: /^b$/, fault: forbidden }], { get: false }],
    ["the nth match", [{ nth: 2, fault: forbidden }], { list: false }],
    ["matches from the nth on", [{ from: 5, fault: forbidden }], { copy: false, delete: false }],
    ["a number of times", [{ times: 1, fault: forbidden }], { head: false }],
  ] as const)("fault %s", async (_, rules, failing) => {
    await seed();
    const expected = {
      head: true,
      list: true,
      later: true,
      get: true,
      copy: true,
      delete: true,
      ...failing,
    };
    expect(await run([...rules])).toEqual(expected);
    expect(proxy.memory?.bucket(bucket).has("a")).toBe(true);
  });

  it("records each request and the fault that answered it", async () => {
    await seed();
    proxy.setRules([{ method: "HEAD", fault: forbidden }]);
    await driver.head("a");
    await driver.get("a");
    expect(proxy.seen).toEqual([
      { method: "HEAD", key: "a", query: "", fault: "status" },
      expect.objectContaining({ method: "GET", key: "a", fault: null }),
    ]);
    proxy.setRules([]);
  });
});

// An answer to HEAD has no body, so the driver takes any 400 to HEAD for a refused key, as RustFS
// refuses one; the object-store adapter then confirms it with a listing.
const refusesHead = (call: string, mode: (typeof FAULT_MODES)[number]) =>
  call === "head" && mode.fault.kind === "status" && mode.fault.status === 400;

// What the S3 driver reports for each fault mode of the tables, on each of its calls: a store that
// fails is unavailable, whatever the call; a slow store is no failure.
describe("the S3 driver on a failing store", () => {
  const { driver } = fresh();
  const calls = {
    head: () => driver.head("a"),
    get: () => driver.get("a"),
    list: () => driver.list("", { recursive: true }),
    put: () => driver.put("n", text("n"), { length: 1, created: 1 }),
    delete: () => driver.delete(["a"]),
    copy: () => driver.copy("a", "a2"),
  } as const;
  const names = ["head", "get", "list", "put", "delete", "copy"] as const;
  const rows = FAULT_MODES.flatMap((mode) => names.map((call) => [mode.name, call, mode] as const));
  const check = async (_mode: string, call: keyof typeof calls, mode: (typeof rows)[number][2]) => {
    expect((await driver.put("a", text("a"), { length: 1, created: 1 })).ok).toBe(true);
    proxy.setRules([{ fault: mode.fault }]);
    const result = await calls[call]();
    proxy.setRules([]);
    const failure = result.ok ? "ok" : result.failure;
    expect(failure).toBe(
      mode.passes ? "ok" : refusesHead(call, mode) ? "name-refused" : "unavailable",
    );
  };
  it.each(rows)("%s: %s", check);
});

// The proxy in front of another store, as in front of RustFS: here the store is a second proxy
// with an in-memory S3, read past the front one as the RustFS target reads RustFS.
describe("the proxy in front of another store", () => {
  const store = startS3Proxy({ pageSize: 3 });
  const front = startS3Proxy({ upstream: store.url });
  afterAll(async () => {
    await front.stop();
    await store.stop();
  });
  const frontClient = createS3Client({
    endpoint: front.url,
    region: "us-east-1",
    bucket: "unused",
    forcePathStyle: true,
    accessKeyId: "proxy",
    secretAccessKey: "proxy-secret",
  });
  let chained = 0;
  storageContract("object store, S3 driver through the proxy to another store", {
    make: () => {
      chained += 1;
      return createObjectStoreStorage({
        driver: createS3Driver({ client: frontClient, bucket: `chained-${chained}` }),
        prefix: "",
        properties: createMemoryPropertyStore(),
      });
    },
    runs: 5,
  });

  it("keeps the Host that the request was signed for", async () => {
    const echo = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => new Response(request.headers.get("host")),
    });
    const passing = startS3Proxy({ upstream: `http://127.0.0.1:${echo.port}` });
    try {
      const answer = await fetch(`${passing.url}/bucket/key`);
      expect(await answer.text()).toBe(new URL(passing.url).host);
    } finally {
      await passing.stop();
      await echo.stop(true);
    }
  });

  it("faults requests before they reach the store", async () => {
    const view = driverView(front.url, "faulted");
    await view.reset({ "a/": "", "a/b": "bee" });
    front.setRules([
      { method: "GET", key: /^a\/b$/, fault: { kind: "status", status: 503, body: "empty" } },
    ]);
    await expect(view.snapshot()).rejects.toThrow("unavailable");
    front.setRules([]);
    expect(await view.snapshot()).toEqual({ "a/": "", "a/b": "bee" });
    expect(store.memory?.bucket("faulted").size).toBe(2);
  });

  it("reads and writes many keys through the driver's view", async () => {
    const view = driverView(store.url, "many");
    const entries = Array.from({ length: 40 }, (_, index) => [`k/${index}`, `v${index}`] as const);
    await view.reset({ old: "x" });
    await view.putMany(entries);
    expect(await view.keys("k/")).toHaveLength(40);
    expect(await view.keys("")).toEqual(
      [...entries.map(([key]) => key), "old"].toSorted((a, b) =>
        Buffer.compare(Buffer.from(a), Buffer.from(b)),
      ),
    );
    expect(await view.snapshot()).toEqual(Object.fromEntries([...entries, ["old", "x"]]));
    await view.reset({});
    expect(await view.keys("")).toEqual([]);
  });
});

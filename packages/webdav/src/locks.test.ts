import { describe, expect, it } from "vitest";
import { covers, createMemoryLockStore, parseIfHeader, type Lock, type LockScope } from "./locks";
import { BASE, ORIGIN, setup } from "./test/harness";

const lockBody = (scope: "exclusive" | "shared" = "exclusive", owner = "<D:href>me</D:href>") =>
  `<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:${scope}/></D:lockscope>` +
  `<D:locktype><D:write/></D:locktype><D:owner>${owner}</D:owner></D:lockinfo>`;

const tokenOf = (response: Response) => (response.headers.get("lock-token") ?? "").slice(1, -1);

describe("LOCK and UNLOCK", () => {
  it("locks a file, blocks other writers and lets the owner write", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const locked = await dav("LOCK", "/f", {
      body: lockBody(),
      headers: { timeout: "Second-600" },
    });
    expect(locked.status).toBe(200);
    const token = tokenOf(locked);
    expect(token).toMatch(/^urn:uuid:/);
    const xml = await locked.text();
    expect(xml).toContain("<D:exclusive/>");
    expect(xml).toContain("<D:timeout>Second-600</D:timeout>");
    expect(xml).toContain('<D:owner><href xmlns="DAV:">me</href></D:owner>');

    const blocked = await put("/f", "y");
    expect(blocked.status).toBe(423);
    expect(await blocked.text()).toContain("lock-token-submitted");
    expect((await dav("DELETE", "/f")).status).toBe(423);
    expect(
      (await dav("MOVE", "/f", { headers: { destination: `${ORIGIN}${BASE}/g` } })).status,
    ).toBe(423);

    expect((await put("/f", "y", { if: `(<${token}>)` })).status).toBe(204);
    expect((await put("/f", "y", { if: "(<urn:uuid:wrong>)" })).status).toBe(412);
    expect((await dav("UNLOCK", "/f", { headers: { "lock-token": `<${token}>` } })).status).toBe(
      204,
    );
    expect((await put("/f", "z")).status).toBe(204);
  });

  it("of two concurrent exclusive LOCKs exactly one succeeds", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const statuses = await Promise.all(
      Array.from({ length: 5 }, async () => (await dav("LOCK", "/f", { body: lockBody() })).status),
    );
    expect(statuses.toSorted((a, b) => a - b)).toEqual([200, 423, 423, 423, 423]);
  });

  it("locking an unmapped URL creates an empty file", async () => {
    const { dav } = setup();
    const response = await dav("LOCK", "/new", { body: lockBody() });
    expect(response.status).toBe(201);
    const got = await dav("GET", "/new");
    expect(got.status).toBe(200);
    expect(await got.text()).toBe("");
  });

  it("refuses a conflicting lock and allows shared locks together", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    await put("/s", "x");
    expect((await dav("LOCK", "/f", { body: lockBody() })).status).toBe(200);
    const conflict = await dav("LOCK", "/f", { body: lockBody() });
    expect(conflict.status).toBe(423);
    expect(await conflict.text()).toContain("no-conflicting-lock");
    expect((await dav("LOCK", "/s", { body: lockBody("shared") })).status).toBe(200);
    expect((await dav("LOCK", "/s", { body: lockBody("shared") })).status).toBe(200);
    expect((await dav("LOCK", "/s", { body: lockBody("exclusive") })).status).toBe(423);
  });

  it("a depth-infinity lock on a collection protects its members", async () => {
    const { mkcol, put, dav } = setup();
    await mkcol("/c");
    await put("/c/a", "x");
    const token = tokenOf(await dav("LOCK", "/c", { body: lockBody() }));
    expect((await put("/c/a", "y")).status).toBe(423);
    expect((await put("/c/new", "y")).status).toBe(423);
    expect((await dav("MKCOL", "/c/sub")).status).toBe(423);
    expect((await put("/c/a", "y", { if: `(<${token}>)` })).status).toBe(204);
    expect((await dav("LOCK", "/c/a", { body: lockBody() })).status).toBe(423);
  });

  it("refreshes a lock with an empty body", async () => {
    const { put, dav, advance } = setup();
    await put("/f", "x");
    const token = tokenOf(
      await dav("LOCK", "/f", { body: lockBody(), headers: { timeout: "Second-100" } }),
    );
    advance(50_000);
    const refreshed = await dav("LOCK", "/f", {
      headers: { if: `(<${token}>)`, timeout: "Second-300" },
    });
    expect(refreshed.status).toBe(200);
    expect(await refreshed.text()).toContain("Second-300");
    expect((await dav("LOCK", "/f", { headers: { if: "(<urn:uuid:nope>)" } })).status).toBe(412);
    expect((await dav("LOCK", "/f")).status).toBe(400);
  });

  it("an expired lock no longer blocks", async () => {
    const { put, dav, advance } = setup();
    await put("/f", "x");
    await dav("LOCK", "/f", { body: lockBody(), headers: { timeout: "Second-10" } });
    advance(11_000);
    expect((await put("/f", "y")).status).toBe(204);
  });

  it("caps the timeout", async () => {
    const { put, dav } = setup({ maxLockTimeout: 60 });
    await put("/f", "x");
    const xml = await (
      await dav("LOCK", "/f", { body: lockBody(), headers: { timeout: "Infinite" } })
    ).text();
    expect(xml).toContain("Second-60");
  });

  it("UNLOCK needs the lock's token", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    await dav("LOCK", "/f", { body: lockBody() });
    expect((await dav("UNLOCK", "/f")).status).toBe(400);
    expect(
      (await dav("UNLOCK", "/f", { headers: { "lock-token": "<urn:uuid:other>" } })).status,
    ).toBe(409);
  });

  it("PROPFIND shows lockdiscovery and supportedlock", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    await dav("LOCK", "/f", { body: lockBody() });
    const xml = await (await dav("PROPFIND", "/f", { headers: { depth: "0" } })).text();
    expect(xml).toContain("<D:activelock>");
    expect(xml).toContain("<D:supportedlock><D:lockentry>");
  });

  it("deleting a locked file with its token removes the lock", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const token = tokenOf(await dav("LOCK", "/f", { body: lockBody() }));
    expect((await dav("DELETE", "/f", { headers: { if: `(<${token}>)` } })).status).toBe(204);
    expect((await put("/f", "y")).status).toBe(201);
  });

  it.each([
    ["no lockinfo", "<D:propfind xmlns:D='DAV:'/>", {}],
    ["no scope", "<D:lockinfo xmlns:D='DAV:'><D:locktype><D:write/></D:locktype></D:lockinfo>", {}],
    ["Depth 1", lockBody(), { depth: "1" }],
  ])("refuses a LOCK with %s", async (_, body, headers) => {
    const { put, dav } = setup();
    await put("/f", "x");
    expect((await dav("LOCK", "/f", { body, headers })).status).toBe(400);
  });
});

describe("If header", () => {
  it.each([
    [
      "(<urn:a>)",
      [{ resource: null, conditions: [{ not: false, kind: "token", value: "urn:a" }] }],
    ],
    [
      '(["etag"])',
      [{ resource: null, conditions: [{ not: false, kind: "etag", value: '"etag"' }] }],
    ],
    [
      "(Not <urn:a> <urn:b>)",
      [
        {
          resource: null,
          conditions: [
            { not: true, kind: "token", value: "urn:a" },
            { not: false, kind: "token", value: "urn:b" },
          ],
        },
      ],
    ],
    [
      "<http://x/a> (<urn:a>) (<urn:b>)",
      [
        { resource: "http://x/a", conditions: [{ not: false, kind: "token", value: "urn:a" }] },
        { resource: "http://x/a", conditions: [{ not: false, kind: "token", value: "urn:b" }] },
      ],
    ],
    [
      '  ([ "e" ] Not <urn:a>)  ',
      [
        {
          resource: null,
          conditions: [
            { not: false, kind: "etag", value: '"e"' },
            { not: true, kind: "token", value: "urn:a" },
          ],
        },
      ],
    ],
  ])("parses %s", (header, expected) => {
    expect(parseIfHeader(header)).toEqual(expected);
  });

  it.each([
    "",
    "urn:a",
    "(",
    "()",
    "(<urn:a)",
    "([x)",
    "(x)",
    "(x])",
    "(<a> x])",
    "<http://x/a> <http://x/b> (<urn:c>)",
    "(<a>) <http://x> (<b>)",
    "<http://x>",
  ])("refuses %j", (header) => {
    expect(parseIfHeader(header)).toBeNull();
  });

  it("a malformed If header is 400", async () => {
    const { put } = setup();
    expect((await put("/f", "x", { if: "garbage" })).status).toBe(400);
  });

  it("evaluates entity tags and Not", async () => {
    const { put } = setup();
    const etag = (await put("/f", "x")).headers.get("etag") ?? "";
    const current = (await put("/f", "z")).headers.get("etag") ?? "";
    expect((await put("/f", "y", { if: `([${etag}])` })).status).toBe(412);
    const latest = await put("/f", "y", { if: `([${current}])` });
    expect(latest.status).toBe(204);
    expect((await put("/f", "y", { if: `(Not [${latest.headers.get("etag")}])` })).status).toBe(
      412,
    );
    expect((await put("/f", "w", { if: "(Not <urn:uuid:none>)" })).status).toBe(204);
  });

  it("evaluates a tagged list against its own resource", async () => {
    const { put, dav } = setup();
    await put("/a", "x");
    await put("/b", "x");
    const token = tokenOf(await dav("LOCK", "/a", { body: lockBody() }));
    expect((await put("/b", "y", { if: `<${ORIGIN}${BASE}/a> (<${token}>)` })).status).toBe(204);
    expect((await put("/b", "y", { if: `<${ORIGIN}${BASE}/b> (<${token}>)` })).status).toBe(412);
  });
});

const lock = (root: string[], depth: "0" | "infinity"): Lock => ({
  token: "t",
  root,
  depth,
  scope: "exclusive",
  owner: "",
  timeout: 1,
  expires: 1,
});

describe("covers", () => {
  it.each([
    [["a"], "0", ["a"], false, true],
    [["a"], "0", ["a", "b"], false, false],
    [["a"], "infinity", ["a", "b"], false, true],
    [["a"], "infinity", ["b"], false, false],
    [["a", "b"], "0", ["a"], false, false],
    [["a", "b"], "0", ["a"], true, true],
    [["ab"], "infinity", ["a"], true, false],
    [[], "infinity", ["x"], false, true],
  ] as const)(
    "lock on %j depth %s covers %j (descendants %s): %s",
    (root, depth, path, descendants, expected) => {
      expect(covers(lock([...root], depth), path, descendants)).toBe(expected);
    },
  );
});

const held = (
  token: string,
  root: string[],
  { depth = "infinity", scope = "exclusive", expires = 10_000, timeout = 10 }: Partial<Lock> = {},
): Lock => ({ token, root, depth, scope, owner: "", timeout, expires });

const tokensCovering = async (
  store: ReturnType<typeof createMemoryLockStore>,
  path: string[],
  now: number,
) => (await store.covering(path, { descendants: true, now })).map((l) => l.token).toSorted();

describe("createMemoryLockStore", () => {
  // Only two shared locks are compatible (RFC 4918 §6.1, §6.2).
  it.each<[LockScope, LockScope, boolean]>([
    ["exclusive", "exclusive", false],
    ["exclusive", "shared", false],
    ["shared", "exclusive", false],
    ["shared", "shared", true],
  ])("stores a %s lock and then a %s lock on it: %s", async (first, second, stored) => {
    const store = createMemoryLockStore();
    expect(await store.create(held("a", ["f"], { scope: first }), 0)).toBe(true);
    expect(await store.create(held("b", ["f"], { scope: second }), 0)).toBe(stored);
    expect(await tokensCovering(store, ["f"], 0)).toEqual(stored ? ["a", "b"] : ["a"]);
  });

  it("refuses a depth-infinity lock over a locked member and accepts a depth-0 one", async () => {
    const store = createMemoryLockStore();
    await store.create(held("member", ["d", "f"]), 0);
    expect(await store.create(held("deep", ["d"]), 0)).toBe(false);
    expect(await store.create(held("shallow", ["d"], { depth: "0" }), 0)).toBe(true);
    expect(await store.create(held("under", ["d", "f", "g"]), 0)).toBe(false);
  });

  it("drops a lock at the moment it expires", async () => {
    const store = createMemoryLockStore();
    await store.create(held("a", ["f"], { expires: 1000 }), 0);
    expect(await tokensCovering(store, ["f"], 999)).toEqual(["a"]);
    expect(await tokensCovering(store, ["f"], 1000)).toEqual([]);
    expect(await store.create(held("b", ["f"]), 1000)).toBe(true);
  });

  it("keeps a refreshed lock until its new expiry", async () => {
    const store = createMemoryLockStore();
    await store.create(held("a", ["f"], { expires: 1000 }), 0);
    const refreshed = await store.refresh("a", 60, 61_000, 500);
    expect(refreshed).toEqual(held("a", ["f"], { expires: 61_000, timeout: 60 }));
    expect(await store.covering(["f"], { descendants: false, now: 5000 })).toEqual([refreshed]);
    expect(await store.refresh("a", 60, 121_000, 61_000)).toBeNull();
    expect(await store.refresh("none", 60, 1000, 0)).toBeNull();
  });

  it("removes one lock by token, and a tree by path", async () => {
    const store = createMemoryLockStore();
    for (const [token, root] of [
      ["d", ["d"]],
      ["df", ["d", "f"]],
      ["e", ["e"]],
      ["dx", ["dx"]],
    ] as const) {
      await store.create(held(token, [...root], { depth: "0" }), 0);
    }
    expect(await store.remove("e")).toBe(true);
    expect(await store.remove("e")).toBe(false);
    await store.removeTree(["d"]);
    expect(await tokensCovering(store, [], 0)).toEqual(["dx"]);
  });
});

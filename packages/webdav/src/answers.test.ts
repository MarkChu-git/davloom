import { createMemoryStorage, fail, type StorageBackend } from "@davloom/core";
import { describe, expect, it } from "vitest";
import { createMemoryLockStore, type LockStore } from "./locks";
import { BASE, ORIGIN, propfindBody, setup } from "./test/harness";

// Exact answers of the handler where the protocol fixes them (RFC 4918, RFC 9110): the status, the
// precondition element of an error body, and the XML of a property, for the cases where a looser
// check would let a wrong answer through.

const lockinfo = (scope = "exclusive", type = "write") =>
  `<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:${scope}/></D:lockscope><D:locktype><D:${type}/></D:locktype></D:lockinfo>`;

type World = ReturnType<typeof setup>;

const lock = async (
  w: World,
  path: string,
  depth: "0" | "infinity",
  scope = "exclusive",
  headers: Record<string, string> = {},
) => {
  const response = await w.dav("LOCK", path, {
    headers: { depth, ...headers },
    body: lockinfo(scope),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    token: (response.headers.get("lock-token") ?? "").slice(1, -1),
  };
};

/** /c holds f.txt and d/g.txt; /out holds h.txt. */
const world = async (options: Parameters<typeof setup>[0] = {}) => {
  const w = setup(options);
  await w.mkcol("/c");
  await w.put("/c/f.txt", "f");
  await w.mkcol("/c/d");
  await w.put("/c/d/g.txt", "g");
  await w.mkcol("/out");
  await w.put("/out/h.txt", "h");
  return w;
};

const tokenSubmitted = (path: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<D:error xmlns:D="DAV:"><D:lock-token-submitted><D:href>${BASE}${path}</D:href></D:lock-token-submitted></D:error>`;

const NO_CONFLICTING_LOCK =
  '<?xml version="1.0" encoding="utf-8"?>\n<D:error xmlns:D="DAV:"><D:no-conflicting-lock/></D:error>';

const prop = (inner: string) => propfindBody(`<D:prop>${inner}</D:prop>`);

/** The content of one property element in a multistatus body, or undefined. */
const element = (xml: string, name: string) => {
  const match = new RegExp(`<D:${name}(?:/>|>(.*?)</D:${name}>)`, "s").exec(xml);
  return match ? (match[1] ?? "") : undefined;
};

describe("locks that block a request, with the lock's root in the error", () => {
  it.each([
    // RFC 4918 §9.6: DELETE of a collection removes its members, so a lock on a member blocks it.
    [
      "DELETE of a collection with a locked member",
      "/c/f.txt",
      "0",
      "DELETE",
      "/c",
      {},
      "/c/f.txt",
    ],
    // §9.9: MOVE removes the source's members.
    [
      "MOVE of a collection with a locked member",
      "/c/d/g.txt",
      "0",
      "MOVE",
      "/c",
      { destination: `${ORIGIN}${BASE}/moved` },
      "/c/d/g.txt",
    ],
    // §7.3: LOCK of an unmapped URL adds a member to the locked parent.
    [
      "LOCK of an unmapped URL in a locked collection",
      "/c",
      "0",
      "LOCK",
      "/c/new.txt",
      { depth: "0" },
      "/c",
    ],
  ] as const)("%s is 423", async (_label, locked, depth, method, path, headers, root) => {
    const w = await world();
    expect((await lock(w, locked, depth)).status).toBe(200);
    const response = await w.dav(method, path, {
      headers,
      body: method === "LOCK" ? lockinfo() : undefined,
    });
    expect(response.status).toBe(423);
    expect(await response.text()).toBe(tokenSubmitted(root));
    expect((await w.dav("GET", "/c/f.txt")).status).toBe(200);
    expect((await w.dav("GET", "/c/new.txt")).status).toBe(404);
  });

  it("MOVE of a locked collection into itself is 403, whatever the lock", async () => {
    const w = await world();
    await lock(w, "/c", "infinity");
    const response = await w.dav("MOVE", "/c", {
      headers: { destination: `${ORIGIN}${BASE}/c/d/inside` },
    });
    expect(response.status).toBe(403);
  });

  it("COPY of a missing source is 404 even onto a locked destination", async () => {
    const w = await world();
    await lock(w, "/out", "infinity");
    const response = await w.dav("COPY", "/missing.txt", {
      headers: { destination: `${ORIGIN}${BASE}/out/h.txt` },
    });
    expect(response.status).toBe(404);
  });

  it("PROPPATCH of a missing resource under a lock is 404", async () => {
    const w = await world();
    await lock(w, "/c", "infinity");
    const response = await w.dav("PROPPATCH", "/c/missing.txt", {
      body: '<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><Z:p xmlns:Z="urn:z">1</Z:p></D:prop></D:set></D:propertyupdate>',
    });
    expect(response.status).toBe(404);
  });
});

describe("the If header", () => {
  it("does not take a lock on a member as a lock on the tagged collection", async () => {
    const w = await world();
    const { token } = await lock(w, "/c/f.txt", "0");
    const response = await w.put("/c/new.txt", "x", { if: `<${BASE}/c> (<${token}>)` });
    expect(response.status).toBe(412);
  });

  it("matches a weak tag in a condition by its text", async () => {
    const w = await world();
    const etag = (await w.dav("HEAD", "/out/h.txt")).headers.get("etag") ?? "";
    expect((await w.put("/out/h.txt", "y", { if: `([W/${etag}])` })).status).toBe(204);
    expect((await w.put("/out/h.txt", "z", { if: `([W/${etag}])` })).status).toBe(412);
  });

  it("finds a tagged list with an unparsable resource false", async () => {
    const w = await world();
    const response = await w.put("/out/h.txt", "y", {
      if: "<http://[> (Not <urn:uuid:00000000-0000-4000-8000-000000000000>)",
    });
    expect(response.status).toBe(412);
  });

  it("fails a PROPFIND whose If header is false with 412", async () => {
    const w = await world();
    const response = await w.dav("PROPFIND", "/c", {
      headers: { depth: "0", if: "(<urn:uuid:00000000-0000-4000-8000-000000000000>)" },
    });
    expect(response.status).toBe(412);
  });
});

/** RFC 4918 §7.3: another client creates /race.txt between the check and the write. */
const racing = (inner: StorageBackend): StorageBackend => ({
  ...inner,
  stat: (path) =>
    path.join("/") === "race.txt" ? Promise.resolve(fail("not-found")) : inner.stat(path),
  write: (path, body, options) =>
    path.join("/") === "race.txt" && options.ifAbsent === true
      ? Promise.resolve(fail("exists"))
      : inner.write(path, body, options),
});

describe("LOCK", () => {
  it.each([
    ["a lock scope that is neither exclusive nor shared", lockinfo("bogus")],
    ["a lock type that is not write", lockinfo("exclusive", "read")],
  ])("refuses %s with 400", async (_label, body) => {
    const w = await world();
    const response = await w.dav("LOCK", "/c/f.txt", { headers: { depth: "0" }, body });
    expect(response.status).toBe(400);
  });

  it("refuses a Depth infinity lock over a locked member", async () => {
    const w = await world();
    await lock(w, "/c/d/g.txt", "0");
    const second = await lock(w, "/c", "infinity");
    expect(second.status).toBe(423);
    expect(second.text).toBe(NO_CONFLICTING_LOCK);
    expect(second.token).toBe("");
  });

  it("checks for a conflict before it creates the unmapped resource", async () => {
    const w = await world();
    const shared = await lock(w, "/c", "infinity", "shared");
    const response = await w.dav("LOCK", "/c/new.txt", {
      headers: { depth: "0", if: `(<${shared.token}>)` },
      body: lockinfo("exclusive"),
    });
    expect(response.status).toBe(423);
    expect(await response.text()).toBe(NO_CONFLICTING_LOCK);
    expect((await w.dav("GET", "/c/new.txt")).status).toBe(404);
  });

  it("refreshes only a lock that covers the resource", async () => {
    const w = await world();
    const other = await lock(w, "/out/h.txt", "0");
    await lock(w, "/c/f.txt", "0");
    const response = await w.dav("LOCK", "/c/f.txt", { headers: { if: `(<${other.token}>)` } });
    expect(response.status).toBe(412);
  });

  it("answers 412 when the store no longer has the lock it refreshes", async () => {
    const inner = createMemoryLockStore();
    const store: LockStore = { ...inner, refresh: () => Promise.resolve(null) };
    const w = await world({ locks: store });
    const { token } = await lock(w, "/c/f.txt", "0");
    const response = await w.dav("LOCK", "/c/f.txt", { headers: { if: `(<${token}>)` } });
    expect(response.status).toBe(412);
  });

  it("answers 423 with no-conflicting-lock when the store refuses the lock", async () => {
    const inner = createMemoryLockStore();
    const store: LockStore = { ...inner, create: () => Promise.resolve(false) };
    const w = await world({ locks: store });
    const response = await w.dav("LOCK", "/c/f.txt", { headers: { depth: "0" }, body: lockinfo() });
    expect(response.status).toBe(423);
    expect(response.headers.get("lock-token")).toBeNull();
    expect(await response.text()).toBe(NO_CONFLICTING_LOCK);
  });

  it("locks a resource another client created meanwhile, with 200", async () => {
    const w = setup({ storage: racing(createMemoryStorage()) });
    const response = await w.dav("LOCK", "/race.txt", {
      headers: { depth: "0" },
      body: lockinfo(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("lock-token")).toMatch(/^<urn:uuid:/);
  });

  it("creates an unmapped resource with 201 and an empty body", async () => {
    const w = await world();
    const created = await lock(w, "/c/new.txt", "0");
    expect(created.status).toBe(201);
    const read = await w.dav("GET", "/c/new.txt");
    expect(read.status).toBe(200);
    expect(read.headers.get("content-length")).toBe("0");
  });
});

describe("PROPFIND values", () => {
  it("writes empty values as empty elements and lists both lock entries", async () => {
    const w = await world();
    const response = await w.dav("PROPFIND", "/c/f.txt", {
      headers: { depth: "0" },
      body: propfindBody("<D:allprop/>"),
    });
    const xml = await response.text();
    expect(xml).toContain("<D:resourcetype/>");
    expect(xml).toContain("<D:lockdiscovery/>");
    expect(element(xml, "supportedlock")).toBe(
      "<D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>" +
        "<D:lockentry><D:lockscope><D:shared/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>",
    );
  });

  it("shows a lock rooted where the key may not lock without its token", async () => {
    const locks = createMemoryLockStore();
    const owner = await world({ locks });
    const { token } = await lock(owner, "/c", "infinity");
    const reader = setup({
      storage: owner.storage,
      locks,
      authorize: ({ method, target }) => !(method === "LOCK" && target.join("/") === "c"),
    });
    const response = await reader.dav("PROPFIND", "/c/f.txt", {
      body: prop("<D:lockdiscovery/>"),
      headers: { depth: "0" },
    });
    const discovery = element(await response.text(), "lockdiscovery") ?? "";
    expect(discovery).toBe(
      "<D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>" +
        "<D:depth>infinity</D:depth><D:timeout>Second-3600</D:timeout>" +
        `<D:lockroot><D:href>${BASE}/c</D:href></D:lockroot></D:activelock>`,
    );
    expect(discovery).not.toContain(token);
  });

  it("reads a propfind only in the DAV: namespace", async () => {
    const w = await world();
    const response = await w.dav("PROPFIND", "/c", {
      headers: { depth: "0" },
      body: '<X:propfind xmlns:X="urn:x" xmlns:D="DAV:"><D:allprop/></X:propfind>',
    });
    expect(response.status).toBe(400);
  });

  it("includes only DAV: quota properties, once each, on collections", async () => {
    const w = await world();
    const response = await w.dav("PROPFIND", "/c", {
      headers: { depth: "1" },
      body: propfindBody(
        '<D:allprop/><D:include><D:quota-used-bytes/><D:displayname/><X:quota-available-bytes xmlns:X="urn:x"/></D:include>',
      ),
    });
    const xml = await response.text();
    expect(xml.match(/<D:quota-used-bytes>/g)).toHaveLength(2);
    expect(xml.match(/<D:displayname>/g)).toHaveLength(3);
    expect(xml).not.toContain("quota-available-bytes");
  });

  it("answers a quota for each Mount of its own", async () => {
    const files = createMemoryStorage();
    const media = createMemoryStorage();
    const { createMountedStorage } = await import("@davloom/core");
    const storage = createMountedStorage(
      [
        { name: "files", backendId: "files", backend: files, root: [] },
        { name: "media", backendId: "media", backend: media, root: [] },
      ],
      0,
    );
    const w = setup({ storage });
    await w.put("/files/a.txt", "12345");
    await w.put("/media/b.txt", "123");
    for (const body of [
      propfindBody("<D:allprop/><D:include><D:quota-used-bytes/></D:include>"),
      prop("<D:quota-used-bytes/>"),
    ]) {
      const response = await w.dav("PROPFIND", "/", { headers: { depth: "1" }, body });
      const xml = await response.text();
      const used = xml.split("<D:response>").flatMap((part) => {
        const href = /<D:href>([^<]*)<\/D:href>/.exec(part)?.[1];
        const bytes = /<D:quota-used-bytes>(\d+)</.exec(part)?.[1];
        return href && bytes ? [`${href} ${bytes}`] : [];
      });
      expect(used).toEqual([`${BASE}/files/ 5`, `${BASE}/media/ 3`]);
    }
  });

  it("leaves the quota out without failing when the backend has none", async () => {
    const w = setup({ storage: { ...createMemoryStorage(), quota: undefined } });
    await w.mkcol("/c");
    for (const body of [
      propfindBody("<D:allprop/><D:include><D:quota-used-bytes/></D:include>"),
      prop("<D:quota-used-bytes/>"),
    ]) {
      const response = await w.dav("PROPFIND", "/c", { headers: { depth: "0" }, body });
      expect(response.status).toBe(207);
      expect(await response.text()).not.toContain("<D:quota-used-bytes>");
    }
  });

  it.each([
    ["a DAV: quota property of a file", "/c/f.txt", "<D:quota-used-bytes/>"],
    ["a quota name in another namespace", "/c", '<X:quota-used-bytes xmlns:X="urn:x"/>'],
  ])("lists %s as missing", async (_label, path, inner) => {
    const w = await world();
    const response = await w.dav("PROPFIND", path, { headers: { depth: "0" }, body: prop(inner) });
    const xml = await response.text();
    expect(xml).toMatch(
      /<D:prop>[^]*quota-used-bytes[^]*<\/D:prop><D:status>HTTP\/1\.1 404 Not Found/,
    );
    expect(xml).not.toContain("HTTP/1.1 200 OK");
  });
});

describe("bodies past the limits", () => {
  const huge = " ".repeat(2 * 1024 * 1024);
  it.each([
    ["PROPFIND", propfindBody(`<D:allprop/>${huge}`)],
    ["PROPPATCH", `<D:propertyupdate xmlns:D="DAV:">${huge}</D:propertyupdate>`],
    ["LOCK", `<D:lockinfo xmlns:D="DAV:">${huge}</D:lockinfo>`],
  ])("%s with a body over the XML limit is 413", async (method, body) => {
    const w = await world();
    const response = await w.dav(method, "/c/f.txt", { headers: { depth: "0" }, body });
    expect(response.status).toBe(413);
  });
});

describe("PUT Content-Length", () => {
  it.each([
    ["0", 201],
    ["-1", 400],
    ["1.5", 400],
    ["x", 400],
  ] as const)("Content-Length %s is %i", async (length, status) => {
    const w = await world();
    const response = await w.dav("PUT", "/out/new.txt", {
      headers: { "content-length": length },
      body: length === "0" ? "" : undefined,
    });
    expect(response.status).toBe(status);
  });
});

const failing = (operation: keyof StorageBackend): StorageBackend => {
  const inner = createMemoryStorage();
  return { ...inner, [operation]: () => Promise.resolve(fail("unavailable")) };
};

describe("a backend that fails part way", () => {
  it.each([
    ["GET", "read", "/f.txt", undefined],
    ["PROPFIND", "list", "/", undefined],
    [
      "PROPPATCH",
      "patchProperties",
      "/f.txt",
      '<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><Z:p xmlns:Z="urn:z">1</Z:p></D:prop></D:set></D:propertyupdate>',
    ],
  ] as const)("%s answers 503 when %s fails", async (method, operation, path, body) => {
    const storage = failing(operation);
    const seeded = setup({ storage });
    // The file is written through the backend itself, whose write still works.
    await storage.write(["f.txt"], new Blob(["f"]).stream(), {});
    const response = await seeded.dav(method, path, { headers: { depth: "1" }, body });
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBeNull();
  });

  it("answers a failure the client cannot act on without a body", async () => {
    const w = await world();
    const response = await w.mkcol("/missing/new");
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("lets an error that is not a backend outage through", async () => {
    const inner = createMemoryStorage();
    const w = setup({
      storage: { ...inner, stat: () => Promise.reject(new TypeError("boom")) },
    });
    await expect(w.dav("GET", "/x")).rejects.toThrow("boom");
  });
});

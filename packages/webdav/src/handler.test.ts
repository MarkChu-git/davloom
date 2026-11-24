import { describe, expect, it } from "vitest";
import { BASE, hrefs, ORIGIN, propfindBody, setup } from "./test/harness";
import { parseXml } from "./xml";

describe("OPTIONS", () => {
  it("advertises Class 1 and 2 with locks", async () => {
    const { dav } = setup();
    const response = await dav("OPTIONS", "/");
    expect(response.status).toBe(200);
    expect(response.headers.get("dav")).toBe("1, 2");
    expect(response.headers.get("allow")).toContain("LOCK");
  });

  it("advertises Class 1 only without a lock store", async () => {
    const { dav } = setup({ locking: false });
    const response = await dav("OPTIONS", "/");
    expect(response.headers.get("dav")).toBe("1");
    expect(response.headers.get("allow")).not.toContain("LOCK");
    expect((await dav("LOCK", "/x")).status).toBe(405);
    expect((await dav("UNLOCK", "/x")).status).toBe(405);
  });
});

describe("paths", () => {
  it.each([
    ["/%2e%2e/etc", 404],
    ["/a%2Fb", 400],
    ["/%00", 400],
    ["/%FF", 400],
    ["/%E4%B8%AD", 404],
    ["/plain", 404],
  ])("GET %s is %i", async (path, status) => {
    const { dav } = setup();
    expect((await dav("GET", path)).status).toBe(status);
  });

  it("answers 404 outside the base path", async () => {
    const { storage } = setup();
    const { createWebDavHandler } = await import("./handler");
    const handler = createWebDavHandler({ basePath: BASE, storage });
    expect((await handler(new Request(`${ORIGIN}/other`))).status).toBe(404);
    expect((await handler(new Request(`${ORIGIN}/davx`))).status).toBe(404);
  });

  it.each(["中文.txt", "a b.txt", "100%.txt", "emoji😀.md", "q?x#y.txt", "plus+sign"])(
    "stores and lists the Unicode name %j",
    async (name) => {
      const { put, dav } = setup();
      const href = `/${encodeURIComponent(name)}`;
      expect((await put(href, "x")).status).toBe(201);
      expect(await (await dav("GET", href)).text()).toBe("x");
      const listing = await (await dav("PROPFIND", "/", { headers: { depth: "1" } })).text();
      expect(hrefs(listing)).toContain(`${BASE}/${encodeURIComponent(name)}`);
    },
  );
});

describe("PUT and GET", () => {
  it("creates, replaces and reads a file", async () => {
    const { put, dav } = setup();
    const created = await put("/a.txt", "hello", { "content-type": "text/plain" });
    expect(created.status).toBe(201);
    expect(created.headers.get("etag")).toMatch(/^"[^"]+"$/);
    const replaced = await put("/a.txt", "world!");
    expect(replaced.status).toBe(204);
    expect(replaced.headers.get("etag")).not.toBe(created.headers.get("etag"));
    const got = await dav("GET", "/a.txt");
    expect(got.status).toBe(200);
    expect(await got.text()).toBe("world!");
    expect(got.headers.get("content-length")).toBe("6");
    expect(got.headers.get("etag")).toBe(replaced.headers.get("etag"));
    expect(got.headers.get("accept-ranges")).toBe("bytes");
  });

  it("HEAD sends the headers without a body", async () => {
    const { put, dav } = setup();
    await put("/a.txt", "hello");
    const head = await dav("HEAD", "/a.txt");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("5");
    expect(await head.text()).toBe("");
  });

  it.each([
    ["/missing/a.txt", 409],
    ["/", 405],
  ])("PUT %s is %i", async (path, status) => {
    const { put } = setup();
    expect((await put(path, "x")).status).toBe(status);
  });

  it("refuses PUT over a collection and under a file", async () => {
    const { put, mkcol } = setup();
    await mkcol("/c");
    await put("/f", "x");
    expect((await put("/c", "x")).status).toBe(405);
    expect((await put("/f/g", "x")).status).toBe(409);
  });

  it("refuses Content-Range on PUT", async () => {
    const { put } = setup();
    expect((await put("/a", "x", { "content-range": "bytes 0-0/1" })).status).toBe(400);
  });

  it("refuses a bad Content-Length", async () => {
    const { dav } = setup();
    const response = await dav("PUT", "/a", { body: "x", headers: { "content-length": "-1" } });
    expect([400]).toContain(response.status);
  });

  it("refuses a file over the size limit", async () => {
    const { put } = setup({ maxFileSize: 3 });
    expect((await put("/a", "abcd")).status).toBe(413);
  });

  it("answers 507 when the backend is full", async () => {
    const { put } = setup({ storageOptions: { capacity: 4 } });
    expect((await put("/a", "abcd")).status).toBe(201);
    expect((await put("/b", "e")).status).toBe(507);
  });

  it("GET of a collection is 405 and GET of a missing file 404", async () => {
    const { mkcol, dav } = setup();
    await mkcol("/c");
    expect((await dav("GET", "/c")).status).toBe(405);
    expect((await dav("GET", "/nope")).status).toBe(404);
  });

  it("guesses a content type from the extension", async () => {
    const { put, dav } = setup();
    await put("/p.png", "x");
    await put("/n", "x");
    expect((await dav("GET", "/p.png")).headers.get("content-type")).toBe("image/png");
    expect((await dav("GET", "/n")).headers.get("content-type")).toBe("application/octet-stream");
  });

  it("stores a binary body byte for byte", async () => {
    const { dav } = setup();
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);
    expect((await dav("PUT", "/bin", { body: bytes })).status).toBe(201);
    expect(new Uint8Array(await (await dav("GET", "/bin")).arrayBuffer())).toEqual(bytes);
  });
});

describe("ranges", () => {
  const body = "0123456789";
  it.each([
    ["bytes=0-3", 206, "0123", "bytes 0-3/10"],
    ["bytes=7-", 206, "789", "bytes 7-9/10"],
    ["bytes=-2", 206, "89", "bytes 8-9/10"],
    ["bytes=5-100", 206, "56789", "bytes 5-9/10"],
    ["bytes=0-0", 206, "0", "bytes 0-0/10"],
    ["bytes=10-", 416, "", "bytes */10"],
    ["bytes=-0", 416, "", "bytes */10"],
    ["bytes=3-1", 200, body, null],
    ["bytes=0-1,3-4", 200, body, null],
    ["items=0-1", 200, body, null],
    ["bytes=x-", 200, body, null],
  ])("Range %s gives %i", async (range, status, text, contentRange) => {
    const { put, dav } = setup();
    await put("/r", body);
    const response = await dav("GET", "/r", { headers: { range } });
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(text);
    expect(response.headers.get("content-range")).toBe(contentRange);
  });

  it("honours If-Range with the current tag and ignores Range with an old one", async () => {
    const { put, dav } = setup();
    const etag = (await put("/r", body)).headers.get("etag") ?? "";
    expect(
      (await dav("GET", "/r", { headers: { range: "bytes=0-1", "if-range": etag } })).status,
    ).toBe(206);
    expect(
      (await dav("GET", "/r", { headers: { range: "bytes=0-1", "if-range": '"old"' } })).status,
    ).toBe(200);
    const modified = (await dav("HEAD", "/r")).headers.get("last-modified") ?? "";
    expect(
      (await dav("GET", "/r", { headers: { range: "bytes=0-1", "if-range": modified } })).status,
    ).toBe(206);
    expect(
      (
        await dav("GET", "/r", {
          headers: { range: "bytes=0-1", "if-range": "Thu, 01 Jan 1970 00:00:00 GMT" },
        })
      ).status,
    ).toBe(200);
  });
});

describe("conditional requests", () => {
  it.each([
    ["if-none-match", "*", "GET", 304],
    ["if-none-match", "CURRENT", "GET", 304],
    ["if-none-match", 'W/"CURRENT_RAW"', "GET", 304],
    ["if-none-match", '"other"', "GET", 200],
    ["if-match", "CURRENT", "GET", 200],
    ["if-match", '"other"', "GET", 412],
    ["if-match", "*", "GET", 200],
    ["if-match", 'W/"CURRENT_RAW"', "GET", 412],
    ["if-none-match", "*", "PUT", 412],
    ["if-match", '"other"', "PUT", 412],
    ["if-match", "CURRENT", "PUT", 204],
    ["if-match", '"other"', "DELETE", 412],
    ["if-match", "CURRENT", "DELETE", 204],
    ["if-modified-since", "Fri, 01 Jan 2100 00:00:00 GMT", "GET", 304],
    ["if-modified-since", "Thu, 01 Jan 1970 00:00:00 GMT", "GET", 200],
    ["if-unmodified-since", "Thu, 01 Jan 1970 00:00:00 GMT", "GET", 412],
    ["if-unmodified-since", "Fri, 01 Jan 2100 00:00:00 GMT", "PUT", 204],
    ["if-modified-since", "not a date", "GET", 200],
  ])("%s: %s on %s gives %i", async (header, value, method, status) => {
    const { put, dav } = setup();
    const etag = (await put("/f", "x")).headers.get("etag") ?? "";
    const resolved = value.replace("CURRENT_RAW", etag.slice(1, -1)).replace("CURRENT", etag);
    const response = await dav(method, "/f", {
      headers: { [header]: resolved },
      body: method === "PUT" ? "y" : undefined,
    });
    expect(response.status).toBe(status);
  });

  it("If-None-Match: * on PUT creates only new files", async () => {
    const { put } = setup();
    expect((await put("/n", "x", { "if-none-match": "*" })).status).toBe(201);
    expect((await put("/n", "x", { "if-none-match": "*" })).status).toBe(412);
  });

  it("If-Match on a missing file fails", async () => {
    const { put } = setup();
    expect((await put("/n", "x", { "if-match": "*" })).status).toBe(412);
  });
});

describe("MKCOL", () => {
  it.each([
    ["creates a collection", [], "/c", 201],
    ["refuses an existing collection", ["/c"], "/c", 405],
    ["refuses without a parent", [], "/a/b", 409],
    ["refuses the root", [], "/", 405],
  ] as const)("%s", async (_, before, path, status) => {
    const { mkcol } = setup();
    for (const p of before) await mkcol(p);
    expect((await mkcol(path)).status).toBe(status);
  });

  it("refuses a body with 415", async () => {
    const { dav } = setup();
    expect((await dav("MKCOL", "/c", { body: "<x/>" })).status).toBe(415);
  });

  it("refuses over an existing file", async () => {
    const { put, mkcol } = setup();
    await put("/f", "x");
    expect((await mkcol("/f")).status).toBe(405);
  });
});

describe("DELETE", () => {
  it("removes a file and a whole collection", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/c");
    await put("/c/a", "x");
    await put("/f", "x");
    expect((await dav("DELETE", "/f")).status).toBe(204);
    expect((await dav("DELETE", "/c")).status).toBe(204);
    expect((await dav("GET", "/c/a")).status).toBe(404);
    expect((await dav("DELETE", "/c")).status).toBe(404);
  });

  it("refuses the root and a Depth other than infinity on a collection", async () => {
    const { mkcol, dav } = setup();
    await mkcol("/c");
    expect((await dav("DELETE", "/")).status).toBe(403);
    expect((await dav("DELETE", "/c", { headers: { depth: "0" } })).status).toBe(400);
    expect((await dav("DELETE", "/c", { headers: { depth: "infinity" } })).status).toBe(204);
  });
});

const dest = (path: string) => ({ destination: `${ORIGIN}${BASE}${path}` });

describe("COPY and MOVE", () => {
  it.each([
    ["COPY", "/f", "/g", {}, 201],
    ["COPY", "/f", "/exists", {}, 204],
    ["COPY", "/f", "/exists", { overwrite: "F" }, 412],
    ["COPY", "/f", "/f", {}, 403],
    ["COPY", "/c", "/c/sub", {}, 403],
    ["COPY", "/c", "/d", {}, 201],
    ["COPY", "/c", "/d", { depth: "0" }, 201],
    ["COPY", "/c", "/d", { depth: "1" }, 400],
    ["COPY", "/missing", "/x", {}, 404],
    ["COPY", "/f", "/nope/x", {}, 409],
    ["COPY", "/f", "/", {}, 403],
    ["COPY", "/f", "/g", { overwrite: "X" }, 400],
    ["MOVE", "/f", "/g", {}, 201],
    ["MOVE", "/f", "/exists", {}, 204],
    ["MOVE", "/f", "/exists", { overwrite: "F" }, 412],
    ["MOVE", "/c", "/c/sub", {}, 403],
    ["MOVE", "/c", "/d", { depth: "0" }, 400],
    ["MOVE", "/c", "/d", { depth: "infinity" }, 201],
    ["MOVE", "/", "/x", {}, 403],
    ["MOVE", "/missing", "/x", {}, 404],
    ["MOVE", "/c/inner", "/c", {}, 403],
    ["COPY", "/c/inner", "/c", {}, 403],
  ])("%s %s to %s with %j gives %i", async (method, from, to, headers, status) => {
    const { put, mkcol, dav } = setup();
    await put("/f", "file");
    await put("/exists", "old");
    await mkcol("/c");
    await put("/c/inner", "inner");
    const response = await dav(method, from, { headers: { ...dest(to), ...headers } });
    expect(response.status).toBe(status);
  });

  it("copies a tree with its content and keeps the source", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/c");
    await mkcol("/c/d");
    await put("/c/d/f", "deep");
    expect((await dav("COPY", "/c", { headers: dest("/e") })).status).toBe(201);
    expect(await (await dav("GET", "/e/d/f")).text()).toBe("deep");
    expect(await (await dav("GET", "/c/d/f")).text()).toBe("deep");
  });

  it("a shallow copy of a collection copies no members", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/c");
    await put("/c/f", "x");
    await dav("COPY", "/c", { headers: { ...dest("/e"), depth: "0" } });
    expect((await dav("PROPFIND", "/e", { headers: { depth: "0" } })).status).toBe(207);
    expect((await dav("GET", "/e/f")).status).toBe(404);
  });

  it("moves a tree and removes the source", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/c");
    await put("/c/f", "x");
    expect((await dav("MOVE", "/c", { headers: dest("/m") })).status).toBe(201);
    expect((await dav("GET", "/c/f")).status).toBe(404);
    expect(await (await dav("GET", "/m/f")).text()).toBe("x");
  });

  it("an overwriting move replaces a collection with a file", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/c");
    await put("/c/f", "x");
    await put("/f", "file");
    expect((await dav("MOVE", "/f", { headers: dest("/c") })).status).toBe(204);
    expect(await (await dav("GET", "/c")).text()).toBe("file");
    expect((await dav("GET", "/c/f")).status).toBe(404);
  });

  it.each([
    [null, 400],
    ["https://elsewhere.example/dav/x", 502],
    [`${ORIGIN}/other/x`, 502],
    [`${ORIGIN}${BASE}/%2e%2e`, 502],
    [`${ORIGIN}${BASE}/a%2Fb`, 400],
    ["/dav/relative", 201],
  ])("Destination %j gives %i", async (destination, status) => {
    const { put, dav } = setup();
    await put("/f", "x");
    const headers: Record<string, string> = destination === null ? {} : { destination };
    expect((await dav("COPY", "/f", { headers })).status).toBe(status);
  });
});

describe("PROPFIND", () => {
  it("lists a collection with Depth 1", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/c");
    await put("/c/a", "x");
    await mkcol("/c/b");
    const response = await dav("PROPFIND", "/c", { headers: { depth: "1" } });
    expect(response.status).toBe(207);
    expect(response.headers.get("content-type")).toContain("xml");
    const xml = await response.text();
    expect(hrefs(xml).toSorted((a = "", b = "") => a.localeCompare(b))).toEqual([
      `${BASE}/c/`,
      `${BASE}/c/a`,
      `${BASE}/c/b/`,
    ]);
    expect(xml).toContain("<D:collection/>");
    expect(xml).toContain("<D:getcontentlength>1</D:getcontentlength>");
  });

  it("refuses Depth infinity on a collection with propfind-finite-depth", async () => {
    const { dav } = setup();
    const response = await dav("PROPFIND", "/");
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("propfind-finite-depth");
  });

  it("allows Depth infinity on a file", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    expect((await dav("PROPFIND", "/f")).status).toBe(207);
  });

  it("reports requested properties as found or 404", async () => {
    const { put, dav } = setup();
    await put("/f", "abc");
    const xml = await (
      await dav("PROPFIND", "/f", {
        headers: { depth: "0" },
        body: propfindBody(
          '<D:prop><D:getcontentlength/><D:getetag/><X:nope xmlns:X="urn:x"/></D:prop>',
        ),
      })
    ).text();
    expect(xml).toContain("<D:getcontentlength>3</D:getcontentlength>");
    expect(xml).toMatch(
      /<D:propstat><D:prop><nope xmlns="urn:x"\/><\/D:prop><D:status>HTTP\/1.1 404 Not Found/,
    );
  });

  it.each([
    [
      100,
      "<D:quota-used-bytes>3</D:quota-used-bytes>",
      "<D:quota-available-bytes>97</D:quota-available-bytes>",
    ],
    [undefined, "<D:quota-used-bytes>3</D:quota-used-bytes>", "<D:quota-available-bytes/>"],
  ])(
    "reports RFC 4331 quota on a collection with capacity %s",
    async (capacity, used, available) => {
      const { put, dav } = setup({ storageOptions: capacity === undefined ? {} : { capacity } });
      await put("/f", "abc");
      const body = propfindBody("<D:prop><D:quota-used-bytes/><D:quota-available-bytes/></D:prop>");
      const xml = await (await dav("PROPFIND", "/", { headers: { depth: "1" }, body })).text();
      expect(xml).toContain(used);
      expect(xml).toContain(available);
      // A file has no quota, and allprop leaves quota out.
      const all = await (await dav("PROPFIND", "/", { headers: { depth: "1" } })).text();
      expect(all).not.toContain("quota");
    },
  );

  it("reports each Mount's own quota in a listing of the root", async () => {
    const { createMemoryStorage, createMountedStorage } = await import("@davloom/core");
    const storage = createMountedStorage([
      { name: "a", backendId: "a", backend: createMemoryStorage({ capacity: 10 }), root: [] },
      { name: "b", backendId: "b", backend: createMemoryStorage({ capacity: 20 }), root: [] },
    ]);
    const { dav } = setup({ storage });
    const body = propfindBody("<D:prop><D:quota-available-bytes/></D:prop>");
    const xml = await (await dav("PROPFIND", "/", { headers: { depth: "1" }, body })).text();
    expect(xml).toContain("<D:quota-available-bytes>10</D:quota-available-bytes>");
    expect(xml).toContain("<D:quota-available-bytes>20</D:quota-available-bytes>");
  });

  it("propname lists names without values", async () => {
    const { put, dav } = setup();
    await put("/f", "abc");
    const xml = await (
      await dav("PROPFIND", "/f", { headers: { depth: "0" }, body: propfindBody("<D:propname/>") })
    ).text();
    expect(xml).toContain("<D:getcontentlength/>");
    expect(xml).not.toContain(">3<");
  });

  it.each([
    ["<not-xml", 400],
    ['<x:other xmlns:x="urn:x"/>', 400],
    ['<!DOCTYPE x [<!ENTITY e "boom">]><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>', 400],
    ['<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>', 207],
  ])("body %j gives %i", async (body, status) => {
    const { dav } = setup();
    expect((await dav("PROPFIND", "/", { headers: { depth: "0" }, body })).status).toBe(status);
  });

  it("refuses a body over the XML limit", async () => {
    const { dav } = setup();
    const body = propfindBody(`<D:prop>${"<D:x/>".repeat(200_000)}</D:prop>`);
    expect((await dav("PROPFIND", "/", { headers: { depth: "0" }, body })).status).toBe(413);
  });

  it("refuses a malformed Depth", async () => {
    const { dav } = setup();
    expect((await dav("PROPFIND", "/", { headers: { depth: "2" } })).status).toBe(400);
  });

  it("is 404 for a missing resource", async () => {
    const { dav } = setup();
    expect((await dav("PROPFIND", "/nope", { headers: { depth: "0" } })).status).toBe(404);
  });
});

const update = (inner: string) =>
  `<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:z">${inner}</D:propertyupdate>`;

describe("PROPPATCH", () => {
  it("keeps xml:lang on a property value and answers well-formed XML", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    await dav("PROPPATCH", "/f", {
      body: update('<D:set><D:prop><Z:a xml:lang="en" Z:q="1">hi</Z:a></D:prop></D:set>'),
    });
    const xml = await (await dav("PROPFIND", "/", { headers: { depth: "1" } })).text();
    expect(xml).toContain('<a xmlns="urn:z" xmlns:a1="urn:z" xml:lang="en" a1:q="1">hi</a>');
    expect(() => parseXml(xml)).not.toThrow();
  });

  it("sets, reads back and removes a dead property", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const set = await dav("PROPPATCH", "/f", {
      body: update(
        '<D:set><D:prop><Z:color>blue <Z:b attr="1">bold</Z:b></Z:color></D:prop></D:set>',
      ),
    });
    expect(set.status).toBe(207);
    expect(await set.text()).toContain("200 OK");
    const read = await (
      await dav("PROPFIND", "/f", {
        headers: { depth: "0" },
        body: propfindBody('<D:prop><Z:color xmlns:Z="urn:z"/></D:prop>'),
      })
    ).text();
    expect(read).toContain('<color xmlns="urn:z">blue <b attr="1">bold</b></color>');
    await dav("PROPPATCH", "/f", {
      body: update("<D:remove><D:prop><Z:color/></D:prop></D:remove>"),
    });
    const gone = await (
      await dav("PROPFIND", "/f", {
        headers: { depth: "0" },
        body: propfindBody('<D:prop><Z:color xmlns:Z="urn:z"/></D:prop>'),
      })
    ).text();
    expect(gone).toContain("404 Not Found");
  });

  it("refuses to set a live property and fails the rest with 424", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const xml = await (
      await dav("PROPPATCH", "/f", {
        body: update("<D:set><D:prop><D:getetag>x</D:getetag><Z:a>1</Z:a></D:prop></D:set>"),
      })
    ).text();
    expect(xml).toContain("403 Forbidden");
    expect(xml).toContain("424 Failed Dependency");
  });

  it("keeps dead properties across MOVE and COPY", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    await dav("PROPPATCH", "/f", { body: update("<D:set><D:prop><Z:a>1</Z:a></D:prop></D:set>") });
    await dav("COPY", "/f", { headers: { destination: `${ORIGIN}${BASE}/g` } });
    await dav("MOVE", "/f", { headers: { destination: `${ORIGIN}${BASE}/h` } });
    for (const path of ["/g", "/h"]) {
      const xml = await (await dav("PROPFIND", path, { headers: { depth: "0" } })).text();
      expect(xml).toContain('<a xmlns="urn:z">1</a>');
    }
  });

  it.each([
    ["", 400],
    ["<D:propfind xmlns:D='DAV:'/>", 400],
    ["<D:propertyupdate xmlns:D='DAV:'><D:set/></D:propertyupdate>", 400],
  ])("body %j gives %i", async (body, status) => {
    const { put, dav } = setup();
    await put("/f", "x");
    expect((await dav("PROPPATCH", "/f", { body })).status).toBe(status);
  });

  it("is 404 for a missing resource", async () => {
    const { dav } = setup();
    expect((await dav("PROPPATCH", "/nope", { body: update("") })).status).toBe(404);
  });
});

describe("other methods", () => {
  it.each(["POST", "TRACE", "PATCH", "SEARCH"])("%s is 405", async (method) => {
    const { dav } = setup();
    expect((await dav(method, "/")).status).toBe(405);
  });

  it("denies what authorize refuses", async () => {
    const { dav, put } = setup({ authorize: ({ method }) => method === "GET" || method === "PUT" });
    await put("/f", "x");
    expect((await dav("GET", "/f")).status).toBe(200);
    expect((await dav("DELETE", "/f")).status).toBe(403);
    expect(
      (await dav("COPY", "/f", { headers: { destination: `${ORIGIN}${BASE}/g` } })).status,
    ).toBe(403);
  });
});

describe("the synchronous limit", () => {
  it.each(["COPY", "MOVE"])(
    "answers 403 with an explanation when %s is over the limit",
    async (method) => {
      const base = setup();
      await base.mkcol("/big");
      const storage = {
        ...base.storage,
        copy: () => Promise.resolve({ ok: false as const, failure: "too-many" as const }),
        move: () => Promise.resolve({ ok: false as const, failure: "too-many" as const }),
      };
      const { dav } = setup({ storage });
      await dav("MKCOL", "/big");
      const response = await dav(method, "/big", {
        headers: { destination: `${ORIGIN}${BASE}/copy` },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await response.text()).toMatch(
        /Nothing was changed\. Copy or move the folder in parts\./,
      );
    },
  );
});

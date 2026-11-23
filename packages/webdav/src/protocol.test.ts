// Protocol details of the handler, each checked against the RFC that defines it: RFC 4918 (WebDAV),
// RFC 9110 (HTTP semantics) and RFC 4331 (quota). Multistatus bodies are read with an XML parser.
import { createMemoryStorage, type StorageBackend } from "@davloom/core";
import { describe, expect, it } from "vitest";
import { createWebDavHandler, type AuthorizeRequest } from "./handler";
import { createMemoryLockStore } from "./locks";
import { BASE, multistatus, names, ORIGIN, propfindBody, setup, valueOf } from "./test/harness";
import { childElements, DAV, parseXml, textOf, XML_LIMITS, type XmlElement } from "./xml";

const CLASS_1 = "OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, PROPFIND, PROPPATCH";
const CLASS_2 = `${CLASS_1}, LOCK, UNLOCK`;
// The harness's clock: 2026-11-24 12:00:00 UTC.
const MODIFIED = "Tue, 24 Nov 2026 12:00:00 GMT";

// The live properties of RFC 4918 §15 in the order the handler lists them.
const FILE_PROPS = [
  "creationdate",
  "displayname",
  "getcontentlength",
  "getcontenttype",
  "getetag",
  "getlastmodified",
  "resourcetype",
  "supportedlock",
  "lockdiscovery",
];
const COLLECTION_PROPS = FILE_PROPS.filter((name) => !name.startsWith("getcontent"));
const WITHOUT_LOCKS = (props: string[]) =>
  props.filter((name) => name !== "supportedlock" && name !== "lockdiscovery");

type Dav = ReturnType<typeof setup>["dav"];

const lockInfo = ({
  scope = "exclusive",
  owner,
}: { scope?: "exclusive" | "shared"; owner?: string } = {}) =>
  `<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:${scope}/></D:lockscope>` +
  `<D:locktype><D:write/></D:locktype>${owner === undefined ? "" : `<D:owner>${owner}</D:owner>`}</D:lockinfo>`;

/** Locks a path and returns its token. */
const lockPath = async (
  dav: Dav,
  path: string,
  {
    depth = "infinity",
    scope = "exclusive",
  }: { depth?: string; scope?: "exclusive" | "shared" } = {},
) => {
  const response = await dav("LOCK", path, { body: lockInfo({ scope }), headers: { depth } });
  expect(response.status).toBeLessThan(300);
  return (response.headers.get("lock-token") ?? "").slice(1, -1);
};

const davElements = (element: XmlElement | undefined, local: string) =>
  element
    ? childElements(element).filter((child) => child.ns === DAV && child.local === local)
    : [];

/** The activelock elements of a LOCK response body or of a lockdiscovery property. */
const activeLocks = (xml: string) => {
  const prop = parseXml(xml);
  const discovery = davElements(prop, "lockdiscovery")[0];
  return davElements(discovery, "activelock");
};

const child = (element: XmlElement | undefined, local: string) => davElements(element, local)[0];

/** The element, which the test needs to be there. */
const must = (element: XmlElement | undefined): XmlElement => {
  if (!element) throw new Error("the element is missing");
  return element;
};

const propfind = async (dav: Dav, path: string, depth: string, body?: string) => {
  const response = await dav("PROPFIND", path, { headers: { depth }, body });
  expect(response.status).toBe(207);
  return multistatus(await response.text());
};

const proppatchBody = (inner: string) =>
  `<D:propertyupdate xmlns:D="DAV:" xmlns:y="urn:y">${inner}</D:propertyupdate>`;

describe("OPTIONS and Allow (RFC 4918 §10.1, RFC 9110 §10.2.1)", () => {
  it.each([
    [true, "1, 2", CLASS_2],
    [false, "1", CLASS_1],
  ])("with locking %s advertises DAV %j and every method", async (locking, dav, allow) => {
    const response = await setup({ locking }).dav("OPTIONS", "/");
    expect(response.status).toBe(200);
    expect(response.headers.get("dav")).toBe(dav);
    expect(response.headers.get("allow")).toBe(allow);
    expect(response.headers.get("ms-author-via")).toBe("DAV");
  });

  // A 405 response must name the allowed methods (RFC 9110 §15.5.6).
  it.each([
    [true, "GET", "/d"],
    [true, "HEAD", "/d"],
    [true, "PUT", "/"],
    [true, "PUT", "/d"],
    [true, "POST", "/f"],
    [false, "LOCK", "/f"],
    [false, "UNLOCK", "/f"],
  ])("with locking %s, %s %s is 405 with Allow", async (locking, method, path) => {
    const { put, mkcol, dav } = setup({ locking });
    await mkcol("/d");
    await put("/f", "x");
    const response = await dav(method, path, { body: method === "PUT" ? "x" : undefined });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe(locking ? CLASS_2 : CLASS_1);
  });
});

describe("GET and HEAD (RFC 9110 §9.3.1, §9.3.2)", () => {
  it("sends the validators and the length", async () => {
    const { put, dav } = setup();
    const etag = (await put("/f", "abc")).headers.get("etag");
    for (const method of ["GET", "HEAD"]) {
      const response = await dav(method, "/f");
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(etag);
      expect(response.headers.get("last-modified")).toBe(MODIFIED);
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("content-length")).toBe("3");
      expect(await response.text()).toBe(method === "GET" ? "abc" : "");
    }
  });

  it.each(["GET", "HEAD"])("%s of a range sends the range's length (RFC 9110 §14.4)", async (m) => {
    const { put, dav } = setup();
    await put("/r", "0123456789");
    const response = await dav(m, "/r", { headers: { range: "bytes=2-5" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(await response.text()).toBe(m === "GET" ? "2345" : "");
  });

  it("an unsatisfiable range is 416 with the length and the tag (RFC 9110 §15.5.17)", async () => {
    const { put, dav } = setup();
    const etag = (await put("/r", "0123456789")).headers.get("etag");
    const response = await dav("GET", "/r", { headers: { range: "bytes=10-" } });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
    expect(response.headers.get("etag")).toBe(etag);
  });

  // If-Range compares entity tags strongly and dates exactly (RFC 9110 §13.1.5).
  it.each([
    ["the current tag", (etag: string) => etag, 206],
    ["the current tag, weak", (etag: string) => `W/${etag}`, 200],
    ["two tags", (etag: string) => `${etag}, "other"`, 200],
    ["another tag", () => '"other"', 200],
    ["the Last-Modified date", () => MODIFIED, 206],
    ["a second later", () => "Tue, 24 Nov 2026 12:00:01 GMT", 200],
    ["neither a tag nor a date", () => "soon", 200],
  ])("If-Range with %s gives %i", async (_, ifRange, status) => {
    const { put, dav } = setup();
    const etag = (await put("/r", "0123456789")).headers.get("etag") ?? "";
    const response = await dav("GET", "/r", {
      headers: { range: "bytes=0-1", "if-range": ifRange(etag) },
    });
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(status === 206 ? "01" : "0123456789");
  });
});

describe("conditional requests (RFC 9110 §13)", () => {
  it("304 carries the validators (RFC 9110 §15.4.5)", async () => {
    const { put, dav } = setup();
    const etag = (await put("/f", "x")).headers.get("etag") ?? "";
    const response = await dav("GET", "/f", { headers: { "if-none-match": etag } });
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(etag);
    expect(response.headers.get("last-modified")).toBe(MODIFIED);
  });

  it.each([
    ["If-None-Match with the tag second in a list", "if-none-match", 'W/"a", CURRENT', "GET", 304],
    ["If-Match with the tag second in a list", "if-match", '"a", CURRENT', "PUT", 204],
    ["If-Match that does not parse", "if-match", "xyzzy", "GET", 412],
    ["If-None-Match that does not parse", "if-none-match", "xyzzy", "GET", 200],
    // Equal dates: not modified since, and unmodified since (RFC 9110 §13.1.3, §13.1.4).
    ["If-Modified-Since the Last-Modified date", "if-modified-since", MODIFIED, "GET", 304],
    ["If-Unmodified-Since the Last-Modified date", "if-unmodified-since", MODIFIED, "PUT", 204],
    [
      "If-Modified-Since a second before",
      "if-modified-since",
      "Tue, 24 Nov 2026 11:59:59 GMT",
      "GET",
      200,
    ],
    [
      "If-Unmodified-Since a second before",
      "if-unmodified-since",
      "Tue, 24 Nov 2026 11:59:59 GMT",
      "PUT",
      412,
    ],
    // Other methods than GET and HEAD fail with 412 where GET would get 304 (RFC 9110 §13.1.2).
    ["If-None-Match: * on DELETE", "if-none-match", "*", "DELETE", 412],
    ["If-None-Match: * on COPY", "if-none-match", "*", "COPY", 412],
    ["If-None-Match: * on MOVE", "if-none-match", "*", "MOVE", 412],
    ["If-Match another tag on COPY", "if-match", '"other"', "COPY", 412],
    ["If-Match the tag on COPY", "if-match", "CURRENT", "COPY", 201],
  ])("%s", async (_, header, value, method, status) => {
    const { put, dav } = setup();
    const etag = (await put("/f", "x")).headers.get("etag") ?? "";
    const response = await dav(method, "/f", {
      headers: { [header]: value.replace("CURRENT", etag), destination: `${BASE}/g` },
      body: method === "PUT" ? "y" : undefined,
    });
    expect(response.status).toBe(status);
  });

  it("ignores If-Unmodified-Since on a resource that does not exist (RFC 9110 §13.1.4)", async () => {
    const { put } = setup();
    expect((await put("/new", "x", { "if-unmodified-since": MODIFIED })).status).toBe(201);
  });
});

describe("PUT (RFC 9110 §9.3.4, RFC 4918 §9.7)", () => {
  it("creates an empty file without a body", async () => {
    const { dav } = setup();
    expect((await dav("PUT", "/e")).status).toBe(201);
    const response = await dav("GET", "/e");
    expect(response.headers.get("content-length")).toBe("0");
    expect(await response.text()).toBe("");
  });

  it.each(["-1", "1.5", "abc", "9007199254740992"])("Content-Length %j is 400", async (length) => {
    const { put } = setup();
    expect((await put("/f", "x", { "content-length": length })).status).toBe(400);
  });

  it.each([
    ["a declared length over the limit", "abcde", { "content-length": "5" }, 413],
    ["a declared length at the limit", "abcd", { "content-length": "4" }, 201],
    ["an undeclared body over the limit", "abcde", {}, 413],
    ["an undeclared body at the limit", "abcd", {}, 201],
  ])("with a 4-byte limit, %s gives %i", async (_, body, headers, status) => {
    const { put, dav } = setup({ maxFileSize: 4 });
    expect((await put("/f", body, headers)).status).toBe(status);
    expect((await dav("HEAD", "/f")).status).toBe(status === 201 ? 200 : 404);
  });

  it("keeps the Content-Type it was sent", async () => {
    const { put, dav } = setup();
    await put("/f.txt", "x", { "content-type": "application/x-custom" });
    expect((await dav("GET", "/f.txt")).headers.get("content-type")).toBe("application/x-custom");
    const [file] = await propfind(dav, "/f.txt", "0");
    expect(valueOf(file, "getcontenttype")).toBe("application/x-custom");
  });

  // A depth-0 lock on a collection protects its membership, not its members (RFC 4918 §7.5).
  it("needs the token of a depth-0 lock on the collection to add a member, not to change one", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/d");
    await put("/d/old", "x");
    const token = await lockPath(dav, "/d", { depth: "0" });
    expect((await put("/d/new", "x")).status).toBe(423);
    expect((await put("/d/new", "x", { if: `<${ORIGIN}${BASE}/d> (<${token}>)` })).status).toBe(
      201,
    );
    expect((await put("/d/old", "y")).status).toBe(204);
  });

  it("is not blocked by a lock on a sibling", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/d");
    await put("/d/sibling", "x");
    await lockPath(dav, "/d/sibling");
    expect((await put("/d/new", "x")).status).toBe(201);
    expect((await dav("MKCOL", "/d/c")).status).toBe(201);
  });

  it("names the lock root of the lock that blocks it (RFC 4918 §16)", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    await lockPath(dav, "/f");
    const response = await put("/f", "y");
    expect(response.status).toBe(423);
    const error = parseXml(await response.text());
    expect(error.ns).toBe(DAV);
    expect(error.local).toBe("error");
    expect(textOf(must(child(child(error, "lock-token-submitted"), "href")))).toBe(`${BASE}/f`);
  });
});

describe("a namespace without a lock store", () => {
  it("writes, moves, copies and removes", async () => {
    const { put, mkcol, dav } = setup({ locking: false });
    expect((await put("/f", "x")).status).toBe(201);
    expect((await mkcol("/d")).status).toBe(201);
    expect((await dav("COPY", "/f", { headers: { destination: `${BASE}/g` } })).status).toBe(201);
    expect((await dav("MOVE", "/g", { headers: { destination: `${BASE}/h` } })).status).toBe(201);
    expect(
      (
        await dav("PROPPATCH", "/f", {
          body: proppatchBody("<D:set><D:prop><y:a>1</y:a></D:prop></D:set>"),
        })
      ).status,
    ).toBe(207);
    expect((await put("/f", "y", { if: "(Not <urn:uuid:none>)" })).status).toBe(204);
    expect((await dav("DELETE", "/h")).status).toBe(204);
    const [file] = await propfind(dav, "/f", "0");
    expect(names(file, 200)).not.toContain("lockdiscovery");
    expect(names(file, 200)).not.toContain("supportedlock");
  });
});

describe("MKCOL (RFC 4918 §9.3)", () => {
  it("refuses even a one-byte body with 415", async () => {
    const { dav } = setup();
    expect((await dav("MKCOL", "/d", { body: "x" })).status).toBe(415);
    expect((await dav("PROPFIND", "/d", { headers: { depth: "0" } })).status).toBe(404);
  });

  it("fails with 412 when the If header fails", async () => {
    const { dav } = setup();
    expect((await dav("MKCOL", "/d", { headers: { if: "(<urn:uuid:none>)" } })).status).toBe(412);
  });

  it("needs the token of a depth-0 lock on the parent", async () => {
    const { mkcol, dav } = setup();
    await mkcol("/d");
    const token = await lockPath(dav, "/d", { depth: "0" });
    expect((await mkcol("/d/c")).status).toBe(423);
    expect(
      (await dav("MKCOL", "/d/c", { headers: { if: `<${ORIGIN}${BASE}/d> (<${token}>)` } })).status,
    ).toBe(201);
  });
});

describe("DELETE (RFC 4918 §9.6)", () => {
  it("ignores Depth on a file", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    expect((await dav("DELETE", "/f", { headers: { depth: "0" } })).status).toBe(204);
  });

  it("fails with 412 when the If header fails", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    expect((await dav("DELETE", "/f", { headers: { if: "(<urn:uuid:none>)" } })).status).toBe(412);
  });

  it("is blocked by a lock on a member, which it names", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/d");
    await put("/d/f", "x");
    const token = await lockPath(dav, "/d/f");
    const response = await dav("DELETE", "/d");
    expect(response.status).toBe(423);
    expect(await response.text()).toContain(`<D:href>${BASE}/d/f</D:href>`);
    expect(
      (await dav("DELETE", "/d", { headers: { if: `<${ORIGIN}${BASE}/d/f> (<${token}>)` } }))
        .status,
    ).toBe(204);
  });

  it("is not blocked by a lock on a sibling", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/d");
    await put("/d/f", "x");
    await put("/d/g", "x");
    await lockPath(dav, "/d/g");
    expect((await dav("DELETE", "/d/f")).status).toBe(204);
  });

  it("removes the locks of what it deletes", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const token = await lockPath(dav, "/f");
    expect((await dav("DELETE", "/f", { headers: { if: `(<${token}>)` } })).status).toBe(204);
    expect((await put("/f", "y")).status).toBe(201);
  });

  it("refuses the root with 403 whatever its locks", async () => {
    const { dav } = setup();
    await lockPath(dav, "/");
    expect((await dav("DELETE", "/")).status).toBe(403);
  });
});

describe("COPY and MOVE (RFC 4918 §9.8, §9.9)", () => {
  it.each([
    ["COPY", "bogus", 400],
    ["COPY", "1", 400],
    ["COPY", "0", 201],
    ["COPY", "infinity", 201],
    ["MOVE", "0", 400],
    ["MOVE", "1", 400],
    ["MOVE", "infinity", 201],
  ])("%s with Depth %j gives %i", async (method, depth, status) => {
    const { mkcol, dav } = setup();
    await mkcol("/d");
    const response = await dav(method, "/d", { headers: { depth, destination: `${BASE}/e` } });
    expect(response.status).toBe(status);
  });

  it.each(["COPY", "MOVE"])("%s of a missing resource is 404", async (method) => {
    const { dav } = setup();
    expect((await dav(method, "/none", { headers: { destination: `${BASE}/e` } })).status).toBe(
      404,
    );
  });

  it.each(["COPY", "MOVE"])("%s fails with 412 when the If header fails", async (method) => {
    const { put, dav } = setup();
    await put("/f", "x");
    const headers = { destination: `${BASE}/g`, if: "(<urn:uuid:none>)" };
    expect((await dav(method, "/f", { headers })).status).toBe(412);
  });

  it.each(["COPY", "MOVE"])("%s asks authorize once, with the destination", async (method) => {
    const calls: AuthorizeRequest[] = [];
    const { put, dav } = setup({
      authorize: (request) => {
        calls.push(request);
        return request.destination !== null || request.method !== method;
      },
    });
    await put("/f", "x");
    calls.length = 0;
    expect((await dav(method, "/f", { headers: { destination: `${BASE}/g` } })).status).toBe(201);
    expect(calls.filter((call) => call.method === method)).toEqual([
      { method, target: ["f"], destination: ["g"] },
    ]);
  });

  it("COPY needs no token for its locked source, and leaves the lock in place", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    await lockPath(dav, "/f");
    expect((await dav("COPY", "/f", { headers: { destination: `${BASE}/g` } })).status).toBe(201);
    expect((await put("/f", "y")).status).toBe(423);
    expect((await put("/g", "y")).status).toBe(204);
  });

  it("MOVE needs the token of its locked source, and leaves the lock behind", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const token = await lockPath(dav, "/f");
    const destination = `${BASE}/g`;
    expect((await dav("MOVE", "/f", { headers: { destination } })).status).toBe(423);
    expect((await dav("MOVE", "/f", { headers: { destination, if: `(<${token}>)` } })).status).toBe(
      201,
    );
    // A lock does not move with its resource (RFC 4918 §7.7).
    expect((await put("/f", "new")).status).toBe(201);
    expect((await put("/g", "y")).status).toBe(204);
  });

  it("MOVE needs the token of a depth-0 lock on the source's parent", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/d");
    await put("/d/f", "x");
    await lockPath(dav, "/d", { depth: "0" });
    expect((await dav("MOVE", "/d/f", { headers: { destination: `${BASE}/g` } })).status).toBe(423);
    expect((await dav("COPY", "/d/f", { headers: { destination: `${BASE}/g` } })).status).toBe(201);
  });

  it.each(["COPY", "MOVE"])("%s needs the token of a lock in the destination", async (method) => {
    const { put, mkcol, dav } = setup();
    await put("/f", "x");
    await mkcol("/e");
    await put("/e/x", "x");
    await lockPath(dav, "/e/x");
    // Overwriting /e would remove the locked /e/x.
    expect((await dav(method, "/f", { headers: { destination: `${BASE}/e` } })).status).toBe(423);
  });

  it.each(["COPY", "MOVE"])(
    "%s needs the token of a depth-0 lock on the destination's parent",
    async (method) => {
      const { put, mkcol, dav } = setup();
      await put("/f", "x");
      await mkcol("/e");
      await put("/e/sibling", "x");
      await lockPath(dav, "/e/sibling");
      expect((await dav(method, "/f", { headers: { destination: `${BASE}/e/new` } })).status).toBe(
        201,
      );
      await lockPath(dav, "/e", { depth: "0" });
      expect(
        (await dav("COPY", "/e/new", { headers: { destination: `${BASE}/e/other` } })).status,
      ).toBe(423);
    },
  );

  // The same source and destination are refused (RFC 4918 §9.8.5), whatever the locks.
  it.each(["COPY", "MOVE"])("%s onto itself is 403 even when locked", async (method) => {
    const { put, dav } = setup();
    await put("/f", "x");
    await lockPath(dav, "/f");
    expect((await dav(method, "/f", { headers: { destination: `${BASE}/f` } })).status).toBe(403);
  });

  it("COPY onto the root is 403 even when the root is locked", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    await lockPath(dav, "/");
    expect((await dav("COPY", "/f", { headers: { destination: `${BASE}/` } })).status).toBe(403);
  });
});

describe("PROPFIND (RFC 4918 §9.1, §15)", () => {
  it("allprop reports every live property with its value", async () => {
    const { put, mkcol, dav } = setup();
    const etag = (await put("/f.txt", "abc")).headers.get("etag");
    await mkcol("/d");
    const responses = await propfind(dav, "/", "1");
    expect(responses.map((response) => response.href)).toEqual([
      `${BASE}/`,
      `${BASE}/f.txt`,
      `${BASE}/d/`,
    ]);
    const [root, file, collection] = responses;
    for (const response of responses) expect(response.propstats[404]).toBeUndefined();

    expect(names(file, 200)).toEqual(FILE_PROPS);
    // RFC 3339 without fractions (RFC 4918 §15.1) and the IMF-fixdate (RFC 9110 §5.6.7).
    expect(valueOf(file, "creationdate")).toBe("2026-11-24T12:00:00Z");
    expect(valueOf(file, "getlastmodified")).toBe(MODIFIED);
    expect(valueOf(file, "displayname")).toBe("f.txt");
    expect(valueOf(file, "getcontentlength")).toBe("3");
    expect(valueOf(file, "getcontenttype")).toBe("text/plain; charset=utf-8");
    expect(valueOf(file, "getetag")).toBe(etag);
    expect(
      childElements(must(file?.propstats[200]?.find((p) => p.local === "resourcetype"))),
    ).toEqual([]);

    expect(names(collection, 200)).toEqual(COLLECTION_PROPS);
    expect(valueOf(collection, "displayname")).toBe("d");
    const resourcetype = collection?.propstats[200]?.find((p) => p.local === "resourcetype");
    expect(childElements(must(resourcetype)).map((e) => [e.ns, e.local])).toEqual([
      [DAV, "collection"],
    ]);

    expect(names(root, 200)).toEqual(COLLECTION_PROPS);
    expect(valueOf(root, "displayname")).toBe("");
    const supported = root?.propstats[200]?.find((p) => p.local === "supportedlock");
    expect(
      davElements(supported, "lockentry").map((entry) => [
        childElements(must(child(entry, "lockscope")))[0]?.local,
        childElements(must(child(entry, "locktype")))[0]?.local,
      ]),
    ).toEqual([
      ["exclusive", "write"],
      ["shared", "write"],
    ]);
  });

  it("leaves the lock properties out without a lock store", async () => {
    const { put, dav } = setup({ locking: false });
    await put("/f", "x");
    const [root, file] = await propfind(dav, "/", "1");
    expect(names(root, 200)).toEqual(WITHOUT_LOCKS(COLLECTION_PROPS));
    expect(names(file, 200)).toEqual(WITHOUT_LOCKS(FILE_PROPS));
    const [named] = await propfind(dav, "/f", "0", propfindBody("<D:propname/>"));
    expect(names(named, 200)).toEqual(WITHOUT_LOCKS(FILE_PROPS));
  });

  it("propname lists the names a resource has, dead ones included", async () => {
    const { put, mkcol, dav } = setup();
    await put("/f", "x");
    await mkcol("/d");
    const body = proppatchBody("<D:set><D:prop><y:color>red</y:color></D:prop></D:set>");
    expect((await dav("PROPPATCH", "/f", { body })).status).toBe(207);
    const [, file, collection] = await propfind(dav, "/", "1", propfindBody("<D:propname/>"));
    expect(names(file, 200)).toEqual([...FILE_PROPS, "{urn:y}color"]);
    expect(names(collection, 200)).toEqual(COLLECTION_PROPS);
    for (const prop of file?.propstats[200] ?? []) expect(prop.children).toEqual([]);
  });

  it.each([
    ["an empty body", undefined],
    ["a body of whitespace", " \n\t "],
    ["allprop", propfindBody("<D:allprop/>")],
    ["allprop and include", propfindBody("<D:allprop/><D:include><D:getetag/></D:include>")],
  ])("%s asks for allprop", async (_, body) => {
    const { put, dav } = setup();
    await put("/f", "x");
    const [file] = await propfind(dav, "/f", "0", body);
    expect(names(file, 200)).toEqual(FILE_PROPS);
    expect(valueOf(file, "getcontentlength")).toBe("1");
  });

  it("propname wins over the elements it does not know", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const [file] = await propfind(dav, "/f", "0", propfindBody("<D:propname/><D:future/>"));
    expect(names(file, 200)).toEqual(FILE_PROPS);
    expect(valueOf(file, "getcontentlength")).toBe("");
  });

  it.each([
    ["a propfind in another namespace", '<x:propfind xmlns:x="urn:x"><x:allprop/></x:propfind>'],
    ["another DAV: element", '<D:propertyupdate xmlns:D="DAV:"/>'],
    ["propname in another namespace", propfindBody('<x:propname xmlns:x="urn:x"/>')],
    ["only unknown elements", propfindBody("<D:future/>")],
    ["an empty propfind", propfindBody("")],
  ])("refuses %s with 400", async (_, body) => {
    const { dav } = setup();
    expect((await dav("PROPFIND", "/", { headers: { depth: "0" }, body })).status).toBe(400);
  });

  it("accepts a body of exactly the XML limit and refuses one byte more with 413", async () => {
    const { dav } = setup();
    const xml = propfindBody("<D:allprop/>");
    const padded = (length: number) => xml + " ".repeat(length - xml.length);
    const at = await dav("PROPFIND", "/", {
      headers: { depth: "0" },
      body: padded(XML_LIMITS.bytes),
    });
    expect(at.status).toBe(207);
    const over = await dav("PROPFIND", "/", {
      headers: { depth: "0" },
      body: padded(XML_LIMITS.bytes + 1),
    });
    expect(over.status).toBe(413);
  });

  it("reads a body that arrives in several chunks", async () => {
    const storage = createMemoryStorage();
    const handler = createWebDavHandler({ basePath: BASE, storage });
    const parts = [
      '<D:propfind xmlns:D="DAV:">',
      "<D:prop><D:resource",
      "type/></D:prop></D:propfind>",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    });
    const response = await handler(
      new Request(`${ORIGIN}${BASE}/`, {
        method: "PROPFIND",
        headers: { depth: "0" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(207);
    const [root] = multistatus(await response.text());
    expect(names(root, 200)).toEqual(["resourcetype"]);
  });

  it.each([
    ["Depth 1 on a file", "/f", "1", [`${BASE}/f`]],
    ["Depth 0 on a collection", "/d", "0", [`${BASE}/d/`]],
    ["Depth 1 on a collection", "/d", "1", [`${BASE}/d/`, `${BASE}/d/g`]],
  ])("%s lists %j", async (_, path, depth, hrefs) => {
    const { put, mkcol, dav } = setup();
    await put("/f", "x");
    await mkcol("/d");
    await put("/d/g", "x");
    expect((await propfind(dav, path, depth)).map((response) => response.href)).toEqual(hrefs);
  });

  it("reports the requested properties, live and dead, as found or 404", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const set = "<D:set><D:prop><y:color>red</y:color><y:size>2</y:size></D:prop></D:set>";
    await dav("PROPPATCH", "/f", { body: proppatchBody(set) });
    const ask = propfindBody(
      '<D:prop xmlns:y="urn:y" xmlns:x="urn:x"><D:getetag/><y:size/><y:missing/><x:getetag/><D:nope/></D:prop>',
    );
    const [file] = await propfind(dav, "/f", "0", ask);
    expect(names(file, 200)).toEqual(["getetag", "{urn:y}size"]);
    expect(names(file, 404)).toEqual(["{urn:y}missing", "{urn:x}getetag", "nope"]);
    expect(textOf(must(file?.propstats[200]?.[1]))).toBe("2");
  });

  it("reports only live properties without reading dead ones", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const [file] = await propfind(
      dav,
      "/f",
      "0",
      propfindBody("<D:prop><D:getetag/><D:displayname/></D:prop>"),
    );
    expect(names(file, 200)).toEqual(["getetag", "displayname"]);
  });

  describe("quota (RFC 4331)", () => {
    const ask = propfindBody(
      '<D:prop xmlns:x="urn:x"><D:quota-used-bytes/><D:quota-available-bytes/><x:quota-used-bytes/></D:prop>',
    );

    it("is reported for collections only, and only in the DAV: namespace", async () => {
      const { put, dav } = setup({ storageOptions: { capacity: 100 } });
      await put("/f", "abc");
      const [root, file] = await propfind(dav, "/", "1", ask);
      expect(valueOf(root, "quota-used-bytes")).toBe("3");
      expect(valueOf(root, "quota-available-bytes")).toBe("97");
      expect(names(root, 404)).toEqual(["{urn:x}quota-used-bytes"]);
      expect(names(file, 200)).toEqual([]);
      expect(names(file, 404)).toEqual([
        "quota-used-bytes",
        "quota-available-bytes",
        "{urn:x}quota-used-bytes",
      ]);
    });

    it("leaves out the available bytes of an unlimited backend", async () => {
      const { dav } = setup();
      const [root] = await propfind(dav, "/", "0", ask);
      expect(names(root, 200)).toEqual(["quota-used-bytes"]);
      expect(names(root, 404)).toEqual(["quota-available-bytes", "{urn:x}quota-used-bytes"]);
    });

    it("is 404 where the backend reports no quota", async () => {
      const memory = createMemoryStorage();
      const storage: StorageBackend = {
        stat: (path) => memory.stat(path),
        list: (path) => memory.list(path),
        read: (path, range) => memory.read(path, range),
        write: (path, body, options) => memory.write(path, body, options),
        createCollection: (path) => memory.createCollection(path),
        remove: (path) => memory.remove(path),
        copy: (from, to, options) => memory.copy(from, to, options),
        move: (from, to, options) => memory.move(from, to, options),
        properties: (paths) => memory.properties(paths),
        patchProperties: (path, set, remove) => memory.patchProperties(path, set, remove),
        usage: () => memory.usage(),
      };
      const { dav } = setup({ storage });
      const [root] = await propfind(dav, "/", "0", ask);
      expect(names(root, 200)).toEqual([]);
    });
  });

  describe("lockdiscovery (RFC 4918 §15.8)", () => {
    it("shows the locks on a resource, not those on its members", async () => {
      const { put, mkcol, dav } = setup();
      await mkcol("/d");
      await put("/d/f", "x");
      await lockPath(dav, "/d/f");
      const [collection, file] = await propfind(dav, "/d", "1");
      expect(valueOf(collection, "lockdiscovery")).toBe("");
      expect(
        davElements(
          file?.propstats[200]?.find((p) => p.local === "lockdiscovery"),
          "activelock",
        ),
      ).toHaveLength(1);
    });

    it("lists every shared lock", async () => {
      const { put, dav } = setup();
      await put("/s", "x");
      const tokens = [
        await lockPath(dav, "/s", { scope: "shared" }),
        await lockPath(dav, "/s", { scope: "shared" }),
      ];
      const [file] = await propfind(
        dav,
        "/s",
        "0",
        propfindBody("<D:prop><D:lockdiscovery/></D:prop>"),
      );
      const discovery = file?.propstats[200]?.[0];
      for (const node of discovery?.children ?? []) expect(typeof node).not.toBe("string");
      const listed = davElements(discovery, "activelock").map((active) =>
        textOf(must(child(child(active, "locktoken"), "href"))),
      );
      expect(listed.toSorted()).toEqual(tokens.toSorted());
    });

    it("hides the token of a lock the credential may not change", async () => {
      let mayLock = true;
      const { put, dav } = setup({ authorize: ({ method }) => mayLock || method !== "LOCK" });
      await put("/f", "x");
      const token = await lockPath(dav, "/f");
      const tokenOf = async () => {
        const [file] = await propfind(dav, "/f", "0");
        const active = davElements(
          file?.propstats[200]?.find((p) => p.local === "lockdiscovery"),
          "activelock",
        );
        expect(active).toHaveLength(1);
        expect(textOf(must(child(child(active[0], "lockroot"), "href")))).toBe(`${BASE}/f`);
        const href = child(child(active[0], "locktoken"), "href");
        return href ? textOf(href) : null;
      };
      expect(await tokenOf()).toBe(token);
      mayLock = false;
      expect(await tokenOf()).toBeNull();
    });

    it("shows neither locks nor dead properties of a resource the credential may not read", async () => {
      let mayRead = true;
      const { dav } = setup({ authorize: ({ method }) => mayRead || method !== "HEAD" });
      await dav("PROPPATCH", "/", {
        body: proppatchBody("<D:set><D:prop><y:note>private</y:note></D:prop></D:set>"),
      });
      await lockPath(dav, "/");
      const [before] = await propfind(dav, "/", "0");
      expect(names(before, 200)).toEqual([...COLLECTION_PROPS, "{urn:y}note"]);
      mayRead = false;
      const [after] = await propfind(dav, "/", "0");
      expect(names(after, 200)).toEqual(COLLECTION_PROPS);
      expect(valueOf(after, "lockdiscovery")).toBe("");
      expect(
        childElements(must(after?.propstats[200]?.find((p) => p.local === "lockdiscovery"))),
      ).toEqual([]);
    });
  });
});

describe("PROPPATCH (RFC 4918 §9.2)", () => {
  it.each([
    ["a propertyupdate in another namespace", '<x:propertyupdate xmlns:x="urn:x"/>', 400],
    ["malformed XML", "<D:propertyupdate", 400],
    ["no body", undefined, 400],
  ])("refuses %s", async (_, body, status) => {
    const { put, dav } = setup();
    await put("/f", "x");
    expect((await dav("PROPPATCH", "/f", { body })).status).toBe(status);
  });

  it("is 404 for a missing resource", async () => {
    const { dav } = setup();
    const body = proppatchBody("<D:set><D:prop><y:a>1</y:a></D:prop></D:set>");
    expect((await dav("PROPPATCH", "/none", { body })).status).toBe(404);
  });

  it("fails with 412 when the If header fails", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const body = proppatchBody("<D:set><D:prop><y:a>1</y:a></D:prop></D:set>");
    expect(
      (await dav("PROPPATCH", "/f", { body, headers: { if: "(<urn:uuid:none>)" } })).status,
    ).toBe(412);
  });

  it("needs the token of a lock on the resource, not of one on a member", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/d");
    await put("/d/f", "x");
    await lockPath(dav, "/d/f");
    const body = proppatchBody("<D:set><D:prop><y:a>1</y:a></D:prop></D:set>");
    expect((await dav("PROPPATCH", "/d/f", { body })).status).toBe(423);
    const response = await dav("PROPPATCH", "/d", { body });
    expect(response.status).toBe(207);
    expect(multistatus(await response.text()).map((r) => r.href)).toEqual([`${BASE}/d/`]);
  });

  it("applies set and remove and ignores the instructions it does not know", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const body = proppatchBody(
      "<y:set><D:prop><y:a>1</y:a></D:prop></y:set>" +
        "<D:future><D:prop><y:b>2</y:b></D:prop></D:future>" +
        "<D:set><D:prop><y:c>3</y:c><y:d>4</y:d></D:prop></D:set>" +
        "<D:remove><D:prop><y:d/></D:prop></D:remove>",
    );
    const [result] = multistatus(await (await dav("PROPPATCH", "/f", { body })).text());
    expect(result?.href).toBe(`${BASE}/f`);
    expect(names(result, 200)).toEqual(["{urn:y}c", "{urn:y}d"]);
    const [file] = await propfind(dav, "/f", "0");
    expect(names(file, 200)).toEqual([...FILE_PROPS, "{urn:y}c"]);
    expect(textOf(must(file?.propstats[200]?.at(-1)))).toBe("3");
  });

  it("refuses a live property with 403, fails the rest with 424 and changes nothing", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const body = proppatchBody(
      "<D:set><D:prop><D:getetag>x</D:getetag><y:a>1</y:a><y:b>2</y:b></D:prop></D:set>",
    );
    const [result] = multistatus(await (await dav("PROPPATCH", "/f", { body })).text());
    expect(names(result, 403)).toEqual(["getetag"]);
    expect(names(result, 424)).toEqual(["{urn:y}a", "{urn:y}b"]);
    expect(names(result, 200)).toEqual([]);
    const [file] = await propfind(dav, "/f", "0");
    expect(names(file, 200).filter((n) => n.startsWith("{"))).toEqual([]);
  });
});

describe("LOCK (RFC 4918 §9.10)", () => {
  it("answers the lock it granted", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const response = await dav("LOCK", "/f", { body: lockInfo() });
    expect(response.status).toBe(200);
    const token = (response.headers.get("lock-token") ?? "").slice(1, -1);
    const [active] = activeLocks(await response.text());
    expect(textOf(must(child(child(active, "locktoken"), "href")))).toBe(token);
    expect(textOf(must(child(child(active, "lockroot"), "href")))).toBe(`${BASE}/f`);
    // Depth defaults to infinity (RFC 4918 §9.10.3) and the timeout to the longest granted.
    expect(textOf(must(child(active, "depth")))).toBe("infinity");
    expect(textOf(must(child(active, "timeout")))).toBe("Second-3600");
    expect(child(active, "owner")).toBeUndefined();
    for (const node of active?.children ?? []) expect(typeof node).not.toBe("string");
  });

  it("keeps every part of the owner", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    const owner = '<D:href>mailto:a@example.com</D:href><x:name xmlns:x="urn:x">A</x:name>';
    const response = await dav("LOCK", "/f", { body: lockInfo({ owner }) });
    const [active] = activeLocks(await response.text());
    const parts = active ? (child(active, "owner")?.children ?? []) : [];
    expect(
      parts.map((part) => (typeof part === "string" ? part : [part.ns, part.local, textOf(part)])),
    ).toEqual([
      [DAV, "href", "mailto:a@example.com"],
      ["urn:x", "name", "A"],
    ]);
  });

  it.each([
    ["0", "0"],
    ["infinity", "infinity"],
    ["Infinity", "infinity"],
  ])("Depth %j grants a lock of depth %j", async (depth, granted) => {
    const { put, dav } = setup();
    await put("/f", "x");
    const response = await dav("LOCK", "/f", { body: lockInfo(), headers: { depth } });
    const [active] = activeLocks(await response.text());
    expect(textOf(must(child(active, "depth")))).toBe(granted);
  });

  // TimeType is Second-n or Infinite, in order of preference (RFC 4918 §10.7); the server grants at
  // most its own limit, here 3600 seconds, and at least one second.
  it.each([
    ["Infinite", 3600],
    ["Second-100", 100],
    ["second-100", 100],
    ["Second-0", 1],
    ["Second-99999", 3600],
    ["Infinite, Second-100", 3600],
    ["Extended, Second-50", 50],
    ["Second-50x, Second-60", 60],
    ["xSecond-50, Second-60", 60],
    ["xInfinite, Second-5", 5],
    ["Infinitex, Second-5", 5],
    ["Bogus", 3600],
  ])("Timeout %j grants %i seconds", async (timeout, seconds) => {
    const { put, dav } = setup();
    await put("/f", "x");
    const response = await dav("LOCK", "/f", { body: lockInfo(), headers: { timeout } });
    const [active] = activeLocks(await response.text());
    expect(textOf(must(child(active, "timeout")))).toBe(`Second-${seconds}`);
  });

  it.each([
    ["malformed XML", "<D:lockinfo", {}],
    ["another root element", '<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>', {}],
    [
      "a lockinfo in another namespace",
      '<x:lockinfo xmlns:x="urn:x" xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></x:lockinfo>',
      {},
    ],
    [
      "a scope in another namespace",
      '<D:lockinfo xmlns:D="DAV:" xmlns:x="urn:x"><D:lockscope><x:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>',
      {},
    ],
    [
      "no lock type",
      '<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope></D:lockinfo>',
      {},
    ],
    [
      "a lock type in another namespace",
      '<D:lockinfo xmlns:D="DAV:" xmlns:x="urn:x"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><x:write/></D:locktype></D:lockinfo>',
      {},
    ],
    [
      "a read lock",
      '<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:read/></D:locktype></D:lockinfo>',
      {},
    ],
    ["Depth 1", lockInfo(), { depth: "1" }],
    ["a malformed Depth", lockInfo(), { depth: "2" }],
  ])("refuses %s with 400", async (_, body, headers: Record<string, string>) => {
    const { put, dav } = setup();
    await put("/f", "x");
    expect((await dav("LOCK", "/f", { body, headers })).status).toBe(400);
  });

  it("fails with 412 when the If header fails", async () => {
    const { put, dav } = setup();
    await put("/f", "x");
    expect(
      (await dav("LOCK", "/f", { body: lockInfo(), headers: { if: "(<urn:uuid:none>)" } })).status,
    ).toBe(412);
  });

  it("a depth-infinity lock conflicts with a lock on a member, a depth-0 lock does not", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/d");
    await put("/d/f", "x");
    await lockPath(dav, "/d/f");
    const infinite = await dav("LOCK", "/d", { body: lockInfo(), headers: { depth: "infinity" } });
    expect(infinite.status).toBe(423);
    expect(await infinite.text()).toContain("<D:no-conflicting-lock/>");
    expect((await dav("LOCK", "/d", { body: lockInfo(), headers: { depth: "0" } })).status).toBe(
      200,
    );
  });

  describe("an unmapped URL (RFC 4918 §7.3)", () => {
    it("is created empty, with 201", async () => {
      const { dav } = setup();
      expect((await dav("LOCK", "/new", { body: lockInfo() })).status).toBe(201);
      expect((await dav("GET", "/new")).headers.get("content-length")).toBe("0");
    });

    it("needs the token of a depth-0 lock on its parent, not of a lock on a sibling", async () => {
      const { put, mkcol, dav } = setup();
      await mkcol("/d");
      await put("/d/sibling", "x");
      await lockPath(dav, "/d/sibling");
      expect((await dav("LOCK", "/d/a", { body: lockInfo() })).status).toBe(201);
      await lockPath(dav, "/d", { depth: "0" });
      expect((await dav("LOCK", "/d/b", { body: lockInfo() })).status).toBe(423);
      expect((await dav("HEAD", "/d/b")).status).toBe(404);
    });

    it("is 409 when its parent is missing", async () => {
      const { dav } = setup();
      expect((await dav("LOCK", "/none/f", { body: lockInfo() })).status).toBe(409);
      expect((await dav("PUT", "/none/g", { body: "x" })).status).toBe(409);
    });
  });

  describe("a refresh (RFC 4918 §9.10.2)", () => {
    it("extends the lock that the If header names", async () => {
      const { put, dav, advance } = setup();
      const etag = (await put("/s", "x")).headers.get("etag") ?? "";
      await lockPath(dav, "/s", { scope: "shared" });
      const second = await lockPath(dav, "/s", { scope: "shared" });
      advance(1000);
      const response = await dav("LOCK", "/s", {
        headers: { if: `([${etag}] <${second}>)`, timeout: "Second-600" },
      });
      expect(response.status).toBe(200);
      const [active] = activeLocks(await response.text());
      expect(textOf(must(child(child(active, "locktoken"), "href")))).toBe(second);
      expect(textOf(must(child(active, "timeout")))).toBe("Second-600");
    });

    it.each([
      ["no If header", () => ({}), 400],
      ["only a Not condition", (token: string) => ({ if: `(Not <${token}>)` }), 400],
      ["an unknown token", () => ({ if: "(<urn:uuid:none>)" }), 412],
    ])("with %s gives %i", async (_, headers, status) => {
      const { put, dav } = setup();
      await put("/f", "x");
      const token = await lockPath(dav, "/f");
      expect((await dav("LOCK", "/f", { headers: headers(token) })).status).toBe(status);
    });

    it("cannot refresh the lock of a member through its collection", async () => {
      const { put, mkcol, dav } = setup();
      await mkcol("/d");
      await put("/d/f", "x");
      const token = await lockPath(dav, "/d/f");
      expect((await dav("LOCK", "/d", { headers: { if: `(<${token}>)` } })).status).toBe(412);
    });
  });
});

describe("UNLOCK (RFC 4918 §9.11)", () => {
  it.each([
    ["a bare token", (token: string) => token],
    ["no closing bracket", (token: string) => `<${token}`],
    ["no opening bracket", (token: string) => `${token}>`],
  ])("refuses a Lock-Token with %s (RFC 4918 §10.5)", async (_, header) => {
    const { put, dav } = setup();
    await put("/f", "x");
    const token = await lockPath(dav, "/f");
    expect((await dav("UNLOCK", "/f", { headers: { "lock-token": header(token) } })).status).toBe(
      400,
    );
    expect((await put("/f", "y")).status).toBe(423);
  });

  it("refuses the token of a lock on a member with 409", async () => {
    const { put, mkcol, dav } = setup();
    await mkcol("/d");
    await put("/d/f", "x");
    const token = await lockPath(dav, "/d/f");
    const response = await dav("UNLOCK", "/d", { headers: { "lock-token": `<${token}>` } });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("<D:lock-token-matches-request-uri/>");
  });
});

describe("request paths", () => {
  it.each([
    ["/dav/a%2Fb", 400],
    ["/dav/%FF", 400],
    ["/dav/a", 404],
    ["/dav", 207],
    ["/davx/a", 404],
  ])("PROPFIND %s is %i", async (pathname, status) => {
    const handler = createWebDavHandler({
      basePath: BASE,
      storage: createMemoryStorage(),
      locks: createMemoryLockStore(),
    });
    const request = new Request(`${ORIGIN}${pathname}`, {
      method: "PROPFIND",
      headers: { depth: "0" },
    });
    expect((await handler(request)).status).toBe(status);
  });
});

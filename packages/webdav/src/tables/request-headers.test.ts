import { describe, expect, it } from "vitest";
import { BASE, hrefs, ORIGIN, setup } from "../test/harness";
import {
  DEPTHS,
  destinationsOf,
  LOCK_BODY,
  OVERWRITES,
  readDepth,
  readOverwrite,
  TIMEOUTS,
  WORLD,
  type Where,
} from "./request-headers-cases";

// Depth, Overwrite, Timeout and Destination (RFC 4918 §10.2, §10.6, §10.7, §10.3): the tables and
// grammars of request-headers-cases.ts, against the handler.

/** The world of request-headers-cases.ts, built with PUT and MKCOL. */
const world = async () => {
  const w = setup({ maxLockTimeout: 3600 });
  for (const [path, content] of Object.entries(WORLD)) {
    if (path.endsWith("/")) await w.mkcol(path.slice(0, -1));
    else await w.put(path, content);
  }
  return w;
};

const withDepth = (depth: string | undefined, headers: Record<string, string> = {}) =>
  depth === undefined ? headers : { ...headers, depth };

describe("Depth", () => {
  // §9.1: a PROPFIND without Depth is infinity, which a server may refuse with 403 and
  // propfind-finite-depth; 0 lists the collection, 1 also its members.
  it.each(DEPTHS)("PROPFIND of a collection with Depth %j", async (depth) => {
    const w = await world();
    const response = await w.dav("PROPFIND", "/c", { headers: withDepth(depth) });
    const body = await response.text();
    const parsed = readDepth(depth);
    if (parsed === "bad") return expect(response.status).toBe(400);
    if (parsed === null || parsed === "infinity") {
      expect(response.status).toBe(403);
      return expect(body).toContain("propfind-finite-depth");
    }
    expect(response.status).toBe(207);
    expect(hrefs(body).toSorted((a = "", b = "") => a.localeCompare(b))).toEqual(
      parsed === "0" ? [`${BASE}/c/`] : [`${BASE}/c/`, `${BASE}/c/d/`, `${BASE}/c/x.txt`],
    );
  });

  it.each(DEPTHS)("PROPFIND of a file with Depth %j", async (depth) => {
    const w = await world();
    const response = await w.dav("PROPFIND", "/f.txt", { headers: withDepth(depth) });
    const body = await response.text();
    // A file has no members, so every valid depth lists only the file.
    if (readDepth(depth) === "bad") return expect(response.status).toBe(400);
    expect(response.status).toBe(207);
    expect(hrefs(body)).toEqual([`${BASE}/f.txt`]);
  });

  // §9.6.1: DELETE of a collection acts as Depth infinity; a client must send no other value.
  it.each(DEPTHS)("DELETE of a collection with Depth %j", async (depth) => {
    const w = await world();
    const response = await w.dav("DELETE", "/c", { headers: withDepth(depth) });
    const parsed = readDepth(depth);
    const deletes = parsed === null || parsed === "infinity";
    expect(deletes ? [204] : [400]).toContain(response.status);
    expect((await w.storage.stat(["c", "d", "y.txt"])).ok).toBe(!deletes);
  });

  // §9.8.3: COPY of a collection takes Depth 0 (the collection alone) or infinity (the default).
  it.each(DEPTHS)("COPY of a collection with Depth %j", async (depth) => {
    const w = await world();
    const response = await w.dav("COPY", "/c", {
      headers: withDepth(depth, { destination: `${ORIGIN}${BASE}/copy` }),
    });
    const parsed = readDepth(depth);
    if (parsed === "bad" || parsed === "1") {
      expect(response.status).toBe(400);
      return expect((await w.storage.stat(["copy"])).ok).toBe(false);
    }
    expect(response.status).toBe(201);
    expect((await w.storage.stat(["copy"])).ok).toBe(true);
    expect((await w.storage.stat(["copy", "d", "y.txt"])).ok).toBe(parsed !== "0");
  });

  // §9.9.2: MOVE of a collection acts as infinity; other values are refused.
  it.each(DEPTHS)("MOVE of a collection with Depth %j", async (depth) => {
    const w = await world();
    const response = await w.dav("MOVE", "/c", {
      headers: withDepth(depth, { destination: `${ORIGIN}${BASE}/moved` }),
    });
    const parsed = readDepth(depth);
    const moves = parsed === null || parsed === "infinity";
    expect(response.status).toBe(moves ? 201 : 400);
    expect((await w.storage.stat(["moved", "d", "y.txt"])).ok).toBe(moves);
    expect((await w.storage.stat(["c"])).ok).toBe(!moves);
  });

  // §9.10.3: LOCK takes Depth 0 or infinity, infinity when absent.
  it.each(DEPTHS)("LOCK of a collection with Depth %j", async (depth) => {
    const w = await world();
    const response = await w.dav("LOCK", "/c", { headers: withDepth(depth), body: LOCK_BODY });
    const body = await response.text();
    const parsed = readDepth(depth);
    if (parsed === "bad" || parsed === "1") return expect(response.status).toBe(400);
    expect(response.status).toBe(200);
    expect(body).toContain(`<D:depth>${parsed === "0" ? "0" : "infinity"}</D:depth>`);
    // An infinite lock covers the members; a Depth 0 lock does not.
    const put = await w.put("/c/x.txt", "changed");
    expect(put.status).toBe(parsed === "0" ? 204 : 423);
  });
});

describe("Overwrite", () => {
  it.each(
    (["COPY", "MOVE"] as const).flatMap((method) =>
      [true, false].flatMap((exists) =>
        OVERWRITES.map((value) => [method, exists, value] as const),
      ),
    ),
  )("%s onto a destination that exists: %s, Overwrite %j", async (method, exists, value) => {
    const w = await world();
    const destination = exists ? "/g.txt" : "/h.txt";
    const response = await w.dav(method, "/f.txt", {
      headers: {
        destination: `${ORIGIN}${BASE}${destination}`,
        ...(value === undefined ? {} : { overwrite: value }),
      },
    });
    const overwrite = readOverwrite(value);
    // §9.8.5 and §9.9.4: 412 when the destination exists and Overwrite is F; 204 when it was
    // replaced; 201 when it was created.
    const status = overwrite === "bad" ? 400 : !exists ? 201 : overwrite ? 204 : 412;
    expect(response.status).toBe(status);
    const read = await w.dav("GET", destination);
    const text = await read.text();
    const done = status === 201 || status === 204;
    expect(text).toBe(done ? "f-content" : exists ? "g-content" : "");
    expect((await w.storage.stat(["f.txt"])).ok).toBe(!(method === "MOVE" && done));
  });
});

describe("Timeout", () => {
  // §10.7: the server need not honor the request, but never grants more than it allows (here
  // 3600 seconds), never a lock that is already expired, and never more than a finite request.
  it.each(TIMEOUTS)("LOCK with Timeout %j", async (value, requested) => {
    const w = await world();
    const response = await w.dav("LOCK", "/f.txt", {
      headers: { depth: "0", ...(value === undefined ? {} : { timeout: value }) },
      body: LOCK_BODY,
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    const granted = Number(/<D:timeout>Second-(\d+)<\/D:timeout>/.exec(body)?.[1]);
    expect(granted).toBeGreaterThanOrEqual(1);
    expect(granted).toBeLessThanOrEqual(
      Math.min(3600, requested === null || requested === 0 ? 3600 : requested),
    );
  });
});

describe("Destination", () => {
  it.each(
    (["COPY", "MOVE"] as const).flatMap((method) =>
      destinationsOf({ origin: ORIGIN, namespace: BASE, root: BASE }).map(
        ([label, value, statuses, created]) => [method, label, value, statuses, created] as const,
      ),
    ),
  )("%s to %s", async (method, _label, value, statuses, created) => {
    const w = await world();
    const response = await w.dav(method, "/f.txt", {
      headers: value === undefined ? {} : { destination: value },
    });
    expect(statuses).toContain(response.status);
    const done = response.status === 201 || response.status === 204;
    if (created !== null && done) {
      const read = await w.dav("GET", `/${encodeURIComponent(created)}`);
      expect(await read.text()).toBe("f-content");
    }
    expect((await w.storage.stat(["f.txt"])).ok).toBe(!(method === "MOVE" && done));
    if (!done) expect(await (await w.dav("GET", "/g.txt")).text()).toBe("g-content");
  });
});

// What the grammars read and what the tables hold, written out (RFC 4918 §10.2, §10.6, §10.7,
// §10.3), so a change to a value or to a grammar that moves an answer fails here, not only in the
// comparison with the handler.
describe("the request-header tables, written out", () => {
  it("reads each Depth", () => {
    expect(DEPTHS.map((depth) => `${JSON.stringify(depth)} -> ${readDepth(depth)}`))
      .toMatchInlineSnapshot(`
      [
        "undefined -> null",
        ""0" -> 0",
        ""1" -> 1",
        ""infinity" -> infinity",
        ""Infinity" -> infinity",
        ""INFINITY" -> infinity",
        "" 1 " -> 1",
        ""2" -> bad",
        ""-1" -> bad",
        ""01" -> bad",
        ""1.0" -> bad",
        ""one" -> bad",
        ""0, 1" -> bad",
        """ -> bad",
        ""infinite" -> bad",
      ]
    `);
  });

  it("reads each Overwrite", () => {
    expect(OVERWRITES.map((value) => `${JSON.stringify(value)} -> ${readOverwrite(value)}`))
      .toMatchInlineSnapshot(`
      [
        "undefined -> true",
        ""T" -> true",
        ""F" -> false",
        ""t" -> true",
        ""f" -> false",
        "" F " -> false",
        ""X" -> bad",
        ""TRUE" -> bad",
        ""false" -> bad",
        """ -> bad",
        ""T, F" -> bad",
        ""0" -> bad",
      ]
    `);
  });

  it("asks for each Timeout", () => {
    expect(TIMEOUTS.map(([value, seconds]) => `${JSON.stringify(value)} -> ${seconds}`))
      .toMatchInlineSnapshot(`
      [
        "undefined -> null",
        ""Second-60" -> 60",
        ""Second-1" -> 1",
        ""second-60" -> 60",
        ""SECOND-120" -> 120",
        ""Second-3600" -> 3600",
        ""Second-3601" -> 3601",
        ""Second-4100000000" -> 4100000000",
        ""Infinite" -> null",
        ""infinite" -> null",
        ""Infinite, Second-60" -> null",
        ""Second-60, Infinite" -> 60",
        ""Second-0" -> 0",
        ""Second--5" -> null",
        ""Second-abc" -> null",
        ""Minutes-5" -> null",
        """ -> null",
        ""Second- 60" -> null",
        ""60" -> null",
      ]
    `);
  });

  const destinations = (where: Where) =>
    destinationsOf(where).map(
      ([label, value, statuses, created]) =>
        `${label}: ${JSON.stringify(value)} -> ${statuses.join("/")} ${created}`,
    );

  it("lists the Destinations for the namespace root of an https origin", () => {
    expect(destinations({ origin: "https://dav.example", namespace: "/dav", root: "/dav" }))
      .toMatchInlineSnapshot(`
      [
        "an absolute URL: "https://dav.example/dav/new.txt" -> 201 new.txt",
        "an absolute path: "/dav/new.txt" -> 201 new.txt",
        "a relative reference: "new.txt" -> 201 new.txt",
        "a network-path reference: "//dav.example/dav/new.txt" -> 201 new.txt",
        "an upper-case host: "https://DAV.EXAMPLE/dav/new.txt" -> 201 new.txt",
        "dot segments: "https://dav.example/dav/c/../new.txt" -> 201 new.txt",
        "a query: "https://dav.example/dav/new.txt?x=1" -> 201 new.txt",
        "a fragment: "https://dav.example/dav/new.txt#top" -> 201 new.txt",
        "an encoded space: "https://dav.example/dav/new%20name.txt" -> 201 new name.txt",
        "encoded UTF-8: "https://dav.example/dav/%C3%A9t%C3%A9.txt" -> 201 été.txt",
        "a collection to replace: "https://dav.example/dav/c/" -> 204 c",
        "a file to replace: "https://dav.example/dav/g.txt" -> 204 g.txt",
        "another host: "https://other.example/dav/new.txt" -> 502 null",
        "another port: "https://dav.example:8443/dav/new.txt" -> 502 null",
        "another host by network path: "//other.example/dav/new.txt" -> 502 null",
        "another scheme: "http://dav.example/dav/new.txt" -> 201/502 null",
        "a path outside the namespace: "https://dav.example/other/new.txt" -> 502/403 null",
        "a path that only starts like the namespace: "https://dav.example/davx/new.txt" -> 502/403 null",
        "the source itself: "https://dav.example/dav/f.txt" -> 403 null",
        "the namespace root: "https://dav.example/dav/" -> 403 null",
        "below the source file: "https://dav.example/dav/f.txt/new.txt" -> 403/409 null",
        "a missing parent: "https://dav.example/dav/missing/new.txt" -> 409 null",
        "an invalid escape: "https://dav.example/dav/%zz" -> 400 null",
        "an encoded NUL: "https://dav.example/dav/a%00b" -> 400 null",
        "an encoded slash in a name: "https://dav.example/dav/a%2Fb" -> 400 null",
        "an unparsable URL: "http://[" -> 400 null",
        "a URN: "urn:example:x" -> 400/502 null",
        "no Destination: undefined -> 400 null",
      ]
    `);
  });

  it("lists the Destinations for a folder on an http origin on port 8443", () => {
    expect(destinations({ origin: "http://h.example:8443", namespace: "/w", root: "/w/folder" }))
      .toMatchInlineSnapshot(`
      [
        "an absolute URL: "http://h.example:8443/w/folder/new.txt" -> 201 new.txt",
        "an absolute path: "/w/folder/new.txt" -> 201 new.txt",
        "a relative reference: "new.txt" -> 201 new.txt",
        "a network-path reference: "//h.example:8443/w/folder/new.txt" -> 201 new.txt",
        "an upper-case host: "http://H.EXAMPLE:8443/w/folder/new.txt" -> 201 new.txt",
        "dot segments: "http://h.example:8443/w/folder/c/../new.txt" -> 201 new.txt",
        "a query: "http://h.example:8443/w/folder/new.txt?x=1" -> 201 new.txt",
        "a fragment: "http://h.example:8443/w/folder/new.txt#top" -> 201 new.txt",
        "an encoded space: "http://h.example:8443/w/folder/new%20name.txt" -> 201 new name.txt",
        "encoded UTF-8: "http://h.example:8443/w/folder/%C3%A9t%C3%A9.txt" -> 201 été.txt",
        "a collection to replace: "http://h.example:8443/w/folder/c/" -> 204 c",
        "a file to replace: "http://h.example:8443/w/folder/g.txt" -> 204 g.txt",
        "another host: "http://other.example/w/folder/new.txt" -> 502 null",
        "another port: "http://h.example:8444/w/folder/new.txt" -> 502 null",
        "another host by network path: "//other.example/w/folder/new.txt" -> 502 null",
        "another scheme: "https://h.example:8443/w/folder/new.txt" -> 201/502 null",
        "a path outside the namespace: "http://h.example:8443/other/new.txt" -> 502/403 null",
        "a path that only starts like the namespace: "http://h.example:8443/wx/new.txt" -> 502/403 null",
        "the source itself: "http://h.example:8443/w/folder/f.txt" -> 403 null",
        "the namespace root: "http://h.example:8443/w/" -> 403 null",
        "below the source file: "http://h.example:8443/w/folder/f.txt/new.txt" -> 403/409 null",
        "a missing parent: "http://h.example:8443/w/folder/missing/new.txt" -> 409 null",
        "an invalid escape: "http://h.example:8443/w/folder/%zz" -> 400 null",
        "an encoded NUL: "http://h.example:8443/w/folder/a%00b" -> 400 null",
        "an encoded slash in a name: "http://h.example:8443/w/folder/a%2Fb" -> 400 null",
        "an unparsable URL: "http://[" -> 400 null",
        "a URN: "urn:example:x" -> 400/502 null",
        "no Destination: undefined -> 400 null",
      ]
    `);
  });

  it("builds the world and sends a lock body", () => {
    expect(WORLD).toEqual({
      "/c/": "",
      "/c/x.txt": "x",
      "/c/d/": "",
      "/c/d/y.txt": "y",
      "/f.txt": "f-content",
      "/g.txt": "g-content",
    });
    expect(LOCK_BODY).toBe(
      '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>',
    );
  });
});

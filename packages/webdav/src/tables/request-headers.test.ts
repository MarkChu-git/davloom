import { describe, expect, it } from "vitest";
import { BASE, hrefs, ORIGIN, setup } from "../test/harness";

// Depth, Overwrite, Timeout and Destination (RFC 4918 §10.2, §10.6, §10.7, §10.3). The grammars
// are written here: Depth = "0" / "1" / "infinity", Overwrite = "T" / "F", both compared
// case-insensitively as ABNF strings are (RFC 5234 §2.3); TimeType = "Second-" 1*DIGIT /
// "Infinite"; Destination = a URI reference resolved against the request URL. Each method accepts
// the Depth values RFC 4918 gives it, and the namespace answers as the model below predicts.

const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';

/** The world: /c holds x.txt and d/y.txt; /f.txt and /g.txt are files. */
const world = async () => {
  const w = setup({ maxLockTimeout: 3600 });
  await w.mkcol("/c");
  await w.put("/c/x.txt", "x");
  await w.mkcol("/c/d");
  await w.put("/c/d/y.txt", "y");
  await w.put("/f.txt", "f-content");
  await w.put("/g.txt", "g-content");
  return w;
};

type DepthValue = "0" | "1" | "infinity" | null;

/** RFC 4918 §10.2: null when the field is absent, "bad" when it is not one of the three values. */
const readDepth = (value: string | undefined): DepthValue | "bad" => {
  if (value === undefined) return null;
  const v = value.trim().toLowerCase();
  return v === "0" || v === "1" || v === "infinity" ? v : "bad";
};

const DEPTHS: readonly (string | undefined)[] = [
  undefined,
  "0",
  "1",
  "infinity",
  "Infinity",
  "INFINITY",
  " 1 ",
  "2",
  "-1",
  "01",
  "1.0",
  "one",
  "0, 1",
  "",
  "infinite",
];

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

const OVERWRITES: readonly (string | undefined)[] = [
  undefined,
  "T",
  "F",
  "t",
  "f",
  " F ",
  "X",
  "TRUE",
  "false",
  "",
  "T, F",
  "0",
];

/** RFC 4918 §10.6: true by default, "bad" when not T or F. */
const readOverwrite = (value: string | undefined): boolean | "bad" => {
  if (value === undefined) return true;
  const v = value.trim().toUpperCase();
  return v === "T" ? true : v === "F" ? false : "bad";
};

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

const TIMEOUTS: readonly (readonly [value: string | undefined, requested: number | null])[] = [
  [undefined, null],
  ["Second-60", 60],
  ["Second-1", 1],
  ["second-60", 60],
  ["SECOND-120", 120],
  ["Second-3600", 3600],
  ["Second-3601", 3601],
  ["Second-4100000000", 4100000000],
  ["Infinite", null],
  ["infinite", null],
  ["Infinite, Second-60", null],
  ["Second-60, Infinite", 60],
  ["Second-0", 0],
  // Not a TimeType: the server chooses.
  ["Second--5", null],
  ["Second-abc", null],
  ["Minutes-5", null],
  ["", null],
  ["Second- 60", null],
  ["60", null],
];

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

const DESTINATIONS: readonly (readonly [
  label: string,
  value: string | undefined,
  statuses: number[],
  created: string | null,
])[] = [
  ["an absolute URL", `${ORIGIN}${BASE}/new.txt`, [201], "new.txt"],
  ["an absolute path", `${BASE}/new.txt`, [201], "new.txt"],
  ["a relative reference", "new.txt", [201], "new.txt"],
  ["a network-path reference", `//dav.example${BASE}/new.txt`, [201], "new.txt"],
  ["an upper-case host", `https://DAV.EXAMPLE${BASE}/new.txt`, [201], "new.txt"],
  ["dot segments", `${ORIGIN}${BASE}/c/../new.txt`, [201], "new.txt"],
  ["a query", `${ORIGIN}${BASE}/new.txt?x=1`, [201], "new.txt"],
  ["a fragment", `${ORIGIN}${BASE}/new.txt#top`, [201], "new.txt"],
  ["an encoded space", `${ORIGIN}${BASE}/new%20name.txt`, [201], "new name.txt"],
  ["encoded UTF-8", `${ORIGIN}${BASE}/%C3%A9t%C3%A9.txt`, [201], "été.txt"],
  ["a collection to replace", `${ORIGIN}${BASE}/c/`, [204], "c"],
  ["a file to replace", `${ORIGIN}${BASE}/g.txt`, [204], "g.txt"],
  // §9.8.5: another server is 502; outside the namespace is not this server's to write.
  ["another host", `https://other.example${BASE}/new.txt`, [502], null],
  ["another port", `https://dav.example:8443${BASE}/new.txt`, [502], null],
  ["another host by network path", `//other.example${BASE}/new.txt`, [502], null],
  ["another scheme", `http://dav.example${BASE}/new.txt`, [201, 502], null],
  ["a path outside the namespace", `${ORIGIN}/other/new.txt`, [502, 403], null],
  ["a path that only starts like the namespace", `${ORIGIN}${BASE}x/new.txt`, [502, 403], null],
  ["the source itself", `${ORIGIN}${BASE}/f.txt`, [403], null],
  ["the namespace root", `${ORIGIN}${BASE}/`, [403], null],
  // Below the source is inside it (403), and its parent is a file (409): either refuses it.
  ["below the source file", `${ORIGIN}${BASE}/f.txt/new.txt`, [403, 409], null],
  ["a missing parent", `${ORIGIN}${BASE}/missing/new.txt`, [409], null],
  ["an invalid escape", `${ORIGIN}${BASE}/%zz`, [400], null],
  ["an encoded NUL", `${ORIGIN}${BASE}/a%00b`, [400], null],
  ["an encoded slash in a name", `${ORIGIN}${BASE}/a%2Fb`, [400], null],
  ["an unparsable URL", "http://[", [400], null],
  ["a URN", "urn:example:x", [400, 502], null],
  ["no Destination", undefined, [400], null],
];

describe("Destination", () => {
  it.each(
    (["COPY", "MOVE"] as const).flatMap((method) =>
      DESTINATIONS.map(
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

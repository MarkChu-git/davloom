import { describe, expect, it } from "vitest";
import { BASE, ORIGIN, setup } from "../test/harness";
import {
  destinationPath,
  rest,
  SOURCES,
  statusesOf,
  subtree,
  TABLE,
  WORLD,
} from "./transfer-cases";
import { snapshot } from "./world";

// COPY and MOVE (RFC 4918 §9.8, §9.9): the table and oracle of transfer-cases.ts, against the
// handler.

const world = async () => {
  const w = setup();
  for (const [path, content] of Object.entries(WORLD)) {
    if (path.endsWith("/")) await w.mkcol(path.slice(0, -1));
    else await w.put(path, content);
  }
  return w;
};

describe("COPY and MOVE", () => {
  it.each(TABLE)(
    "%s of %s onto %s, Overwrite %s",
    async (method, source, destination, overwrite) => {
      const w = await world();
      const from = SOURCES[source];
      const to = destinationPath(destination, from);
      const before = await snapshot(w.storage, "");
      const response = await w.dav(method, from, {
        headers: { destination: `${ORIGIN}${BASE}${to}`, overwrite: overwrite ? "T" : "F" },
      });
      await response.body?.cancel();
      expect(statusesOf(source, destination, overwrite)).toContain(response.status);
      const after = await snapshot(w.storage, "");
      if (response.status >= 400) return expect(after).toEqual(before);
      // The destination is exactly the source's tree; nothing of what it replaced remains.
      expect(subtree(after, to)).toEqual(subtree(before, from));
      if (method === "COPY") expect(subtree(after, from)).toEqual(subtree(before, from));
      else expect(subtree(after, from)).toEqual({});
      // Everything else is as it was.
      expect(rest(after, from, to)).toEqual(rest(before, from, to));
    },
  );
});

// The oracle, written out (RFC 4918 §9.8, §9.9): for each source and destination, the path the
// request names and the statuses allowed with Overwrite T and then F. A change to the table or to
// the oracle that moves an answer fails here, not only in the comparison with the handler.
describe("the COPY and MOVE table, written out", () => {
  it("allows these statuses", () => {
    const rows = new Set<string>();
    for (const [, source, destination] of TABLE) {
      const statuses = [true, false].map((overwrite) =>
        statusesOf(source, destination, overwrite).join("/"),
      );
      rows.add(
        `${source} onto ${destination} (${destinationPath(destination, SOURCES[source])}): T ${statuses[0]}, F ${statuses[1]}`,
      );
    }
    expect([...rows]).toMatchInlineSnapshot(`
      [
        "a file onto a new name (/new): T 201, F 201",
        "a file onto an existing file (/df.txt): T 204, F 412",
        "a file onto an existing collection (/dc): T 204, F 412",
        "a file onto a name with no parent (/nope/new): T 409, F 409",
        "a file onto a name under a file (/df.txt/new): T 409, F 409",
        "a file onto a name inside the source (/p/s.txt/inner): T 403/409, F 403/409",
        "a file onto the source itself (/p/s.txt): T 403, F 403",
        "a file onto the source's parent (/p): T 403, F 403/412",
        "an empty collection onto a new name (/new): T 201, F 201",
        "an empty collection onto an existing file (/df.txt): T 204, F 412",
        "an empty collection onto an existing collection (/dc): T 204, F 412",
        "an empty collection onto a name with no parent (/nope/new): T 409, F 409",
        "an empty collection onto a name under a file (/df.txt/new): T 409, F 409",
        "an empty collection onto a name inside the source (/p/e/inner): T 403, F 403",
        "an empty collection onto the source itself (/p/e): T 403, F 403",
        "an empty collection onto the source's parent (/p): T 403, F 403/412",
        "a collection with members onto a new name (/new): T 201, F 201",
        "a collection with members onto an existing file (/df.txt): T 204, F 412",
        "a collection with members onto an existing collection (/dc): T 204, F 412",
        "a collection with members onto a name with no parent (/nope/new): T 409, F 409",
        "a collection with members onto a name under a file (/df.txt/new): T 409, F 409",
        "a collection with members onto a name inside the source (/p/m/inner): T 403, F 403",
        "a collection with members onto the source itself (/p/m): T 403, F 403",
        "a collection with members onto the source's parent (/p): T 403, F 403/412",
      ]
    `);
    expect(TABLE).toHaveLength(2 * 3 * 8 * 2);
    expect(new Set(TABLE.map(([method, , , overwrite]) => `${method} ${overwrite}`))).toEqual(
      new Set(["COPY true", "COPY false", "MOVE true", "MOVE false"]),
    );
  });

  const snap = {
    "/p/": "collection []",
    "/p/m/": 'collection [{"name":"x"}]',
    "/p/m/x.txt": 'file x-content [{"name":"y"}]',
    "/p/mx/": "collection []",
    "/q/p/m/y.txt": "file y []",
    "/p/m.txt": "file m []",
  };

  it("takes the subtree under a path, without dead properties", () => {
    expect(subtree(snap, "/p/m")).toEqual({
      "/": "collection",
      "/x.txt": "file x-content",
    });
    expect(subtree({ "/p/m.txt": "file m [x] [y]" }, "/p/m.txt")).toEqual({ "": "file m" });
    expect(subtree({ "/a": "file a [x]b" }, "/a")).toEqual({ "": "file a [x]b" });
    expect(subtree(snap, "/nothing")).toEqual({});
  });

  it("takes the rest of a snapshot", () => {
    expect(rest(snap, "/p/m", "/q")).toEqual({
      "/p/": "collection []",
      "/p/mx/": "collection []",
      "/p/m.txt": "file m []",
    });
    expect(rest(snap, "/p/m.txt", "/p/mx")).toEqual({
      "/p/": "collection []",
      "/p/m/": 'collection [{"name":"x"}]',
      "/p/m/x.txt": 'file x-content [{"name":"y"}]',
      "/q/p/m/y.txt": "file y []",
    });
  });

  it("builds the world", () => {
    expect(WORLD).toEqual({
      "/p/": "",
      "/p/s.txt": "source-file",
      "/p/e/": "",
      "/p/m/": "",
      "/p/m/x.txt": "x-content",
      "/p/m/sub/": "",
      "/p/m/sub/y.txt": "y-content",
      "/df.txt": "old-file",
      "/dc/": "",
      "/dc/z.txt": "old-member",
    });
  });
});

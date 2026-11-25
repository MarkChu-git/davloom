import { describe, expect, it } from "vitest";
import { setup } from "../test/harness";
import {
  conflicts,
  covers,
  lockBody,
  TABLE,
  WORLD,
  type Depth,
  type Scope,
} from "./lock-conflicts-cases";

// Lock compatibility (RFC 4918 §6.1, §7, §9.10.6): the table and oracle of lock-conflicts-cases.ts,
// against the handler.

const world = async () => {
  const w = setup();
  for (const [path, content] of Object.entries(WORLD)) {
    if (path.endsWith("/")) await w.mkcol(path.slice(0, -1));
    else await w.put(path, content);
  }
  return w;
};

const lock = (w: Awaited<ReturnType<typeof world>>, path: string, scope: Scope, depth: Depth) =>
  w.dav("LOCK", path, { headers: { depth, timeout: "Second-600" }, body: lockBody(scope) });

describe("lock conflicts", () => {
  it.each(TABLE)(
    "a %s %s lock (Depth %s) then a %s %s lock (Depth %s)",
    async (held, heldScope, heldDepth, wanted, wantedScope, wantedDepth) => {
      const w = await world();
      const first = await lock(w, held, heldScope, heldDepth);
      await first.body?.cancel();
      expect(first.status).toBe(200);
      const second = await lock(w, wanted, wantedScope, wantedDepth);
      const body = await second.text();
      const conflict = conflicts(
        { root: held, scope: heldScope, depth: heldDepth },
        { root: wanted, scope: wantedScope, depth: wantedDepth },
      );
      expect(second.status).toBe(conflict ? 423 : 200);
      if (conflict) {
        expect(body).toContain("no-conflicting-lock");
        expect(second.headers.get("lock-token")).toBeNull();
      } else {
        expect(second.headers.get("lock-token")).toMatch(/^<urn:uuid:[0-9a-f-]{36}>$/);
        expect(second.headers.get("lock-token")).not.toBe(first.headers.get("lock-token"));
      }
      // PROPFIND shows every lock that covers the wanted resource, and only those.
      const discovery = await w.dav("PROPFIND", wanted, {
        headers: { depth: "0" },
        body: '<D:propfind xmlns:D="DAV:"><D:prop><D:lockdiscovery/></D:prop></D:propfind>',
      });
      const xml = await discovery.text();
      const shown = (xml.match(/<D:activelock>/g) ?? []).length;
      const expected = (covers(held, heldDepth, wanted) ? 1 : 0) + (conflict ? 0 : 1);
      expect(shown).toBe(expected);
    },
  );
});

// The oracle, written out (RFC 4918 §6.1, §9.10.6): for each held and wanted root, whether a new
// lock conflicts, for the held lock exclusive Depth 0, exclusive infinity, shared 0 and shared
// infinity in turn, each against the wanted lock in the same four forms ("x" for a conflict). A
// change to a place or to the oracle that moves an answer fails here, not only in the comparison
// with the handler.
describe("the lock-conflict table, written out", () => {
  it("conflicts as written", () => {
    const rows = new Map<string, string>();
    for (const [held, heldScope, heldDepth, wanted, wantedScope, wantedDepth] of TABLE) {
      const key = `${held} then ${wanted}`;
      const conflict = conflicts(
        { root: held, scope: heldScope, depth: heldDepth },
        { root: wanted, scope: wantedScope, depth: wantedDepth },
      );
      rows.set(key, `${rows.get(key) ?? ""}${conflict ? "x" : "."}`);
    }
    expect(Object.fromEntries(rows)).toMatchInlineSnapshot(`
      {
        "/c then /c": "xxxxxxxxxx..xx..",
        "/c then /c/d/g.txt": "....xxxx....xx..",
        "/c then /c/f.txt": "....xxxx....xx..",
        "/c then /other.txt": "................",
        "/c/d then /c": ".x.x.x.x.x...x..",
        "/c/d then /c/f.txt": "................",
        "/c/d/g.txt then /c": ".x.x.x.x.x...x..",
        "/c/f.txt then /c/f.txt": "xxxxxxxxxx..xx..",
      }
    `);
  });

  it.each([
    ["/c", "0", "/c", true],
    ["/c", "0", "/c/", true],
    ["/c/", "0", "c", true],
    ["/c", "0", "/c/f.txt", false],
    ["/c", "infinity", "/c/f.txt", true],
    ["/c", "infinity", "/c/d/g.txt", true],
    ["/c", "infinity", "/cd", false],
    ["/c", "infinity", "/", false],
    ["/c/d", "infinity", "/c", false],
    ["/", "infinity", "/other.txt", true],
    ["/", "0", "/other.txt", false],
  ] as const)("a lock on %s with Depth %s covers %s: %s", (root, depth, path, covered) => {
    expect(covers(root, depth, path)).toBe(covered);
  });

  it("sends a lock body and builds the world", () => {
    expect(lockBody("shared")).toBe(
      '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:shared/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>o</D:owner></D:lockinfo>',
    );
    expect(WORLD).toEqual({
      "/c/": "",
      "/c/f.txt": "f",
      "/c/d/": "",
      "/c/d/g.txt": "g",
      "/other.txt": "o",
    });
  });
});

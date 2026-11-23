import { describe, expect, it } from "vitest";
import { setup } from "../test/harness";

// Lock compatibility (RFC 4918 §6.1, §7, §9.10.6). The oracle: a lock covers its root and, with
// Depth infinity, everything under it. A new lock conflicts with a held one when either covers the
// other's root, unless both are shared; a conflict is 423 with no-conflicting-lock, and nothing
// changes. Depth infinity on a file covers the file alone.

const lockBody = (scope: Scope) =>
  `<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:${scope}/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>o</D:owner></D:lockinfo>`;

type Scope = "exclusive" | "shared";
type Depth = "0" | "infinity";

const names = (path: string) => path.split("/").filter((name) => name !== "");
const within = (inner: string, outer: string) => {
  const a = names(inner);
  const b = names(outer);
  return a.length >= b.length && b.every((name, i) => a[i] === name);
};

/** Whether a lock on `root` with `depth` covers `path`. */
const covers = (root: string, depth: Depth, path: string) =>
  depth === "infinity" ? within(path, root) : names(path).join("/") === names(root).join("/");

const conflicts = (
  held: { root: string; scope: Scope; depth: Depth },
  wanted: { root: string; scope: Scope; depth: Depth },
) =>
  (covers(held.root, held.depth, wanted.root) || covers(wanted.root, wanted.depth, held.root)) &&
  !(held.scope === "shared" && wanted.scope === "shared");

const PLACES: readonly (readonly [held: string, wanted: string])[] = [
  ["/c", "/c"],
  ["/c", "/c/f.txt"],
  ["/c", "/c/d/g.txt"],
  ["/c/d", "/c"],
  ["/c/d/g.txt", "/c"],
  ["/c", "/other.txt"],
  ["/c/d", "/c/f.txt"],
  ["/c/f.txt", "/c/f.txt"],
];
const SCOPES: readonly Scope[] = ["exclusive", "shared"];
const DEPTHS: readonly Depth[] = ["0", "infinity"];

const TABLE = PLACES.flatMap(([held, wanted]) =>
  SCOPES.flatMap((heldScope) =>
    DEPTHS.flatMap((heldDepth) =>
      SCOPES.flatMap((wantedScope) =>
        DEPTHS.map(
          (wantedDepth) => [held, heldScope, heldDepth, wanted, wantedScope, wantedDepth] as const,
        ),
      ),
    ),
  ),
);

const world = async () => {
  const w = setup();
  await w.mkcol("/c");
  await w.put("/c/f.txt", "f");
  await w.mkcol("/c/d");
  await w.put("/c/d/g.txt", "g");
  await w.put("/other.txt", "o");
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

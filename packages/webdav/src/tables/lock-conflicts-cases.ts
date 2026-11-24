// Lock compatibility (RFC 4918 §6.1, §7, §9.10.6). The oracle: a lock covers its root and, with
// Depth infinity, everything under it. A new lock conflicts with a held one when either covers the
// other's root, unless both are shared; a conflict is 423 with no-conflicting-lock, and nothing
// changes. Depth infinity on a file covers the file alone. lock-conflicts.test.ts runs the table in
// process, and tests/integration/compat/http/protocol-tables.test.ts over HTTP against real
// servers.

export const lockBody = (scope: Scope) =>
  `<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:${scope}/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>o</D:owner></D:lockinfo>`;

export type Scope = "exclusive" | "shared";
export type Depth = "0" | "infinity";

const names = (path: string) => path.split("/").filter((name) => name !== "");
const within = (inner: string, outer: string) => {
  const a = names(inner);
  const b = names(outer);
  return a.length >= b.length && b.every((name, i) => a[i] === name);
};

/** Whether a lock on `root` with `depth` covers `path`. */
export const covers = (root: string, depth: Depth, path: string) =>
  depth === "infinity" ? within(path, root) : names(path).join("/") === names(root).join("/");

export const conflicts = (
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

export const TABLE = PLACES.flatMap(([held, wanted]) =>
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

/** The world: /c holds f.txt and d/g.txt; /other.txt is a file. */
export const WORLD: Readonly<Record<string, string>> = {
  "/c/": "",
  "/c/f.txt": "f",
  "/c/d/": "",
  "/c/d/g.txt": "g",
  "/other.txt": "o",
};

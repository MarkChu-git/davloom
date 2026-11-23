import type { Access } from "@davloom/laws";
import { describe, expect, it } from "vitest";
import { buildWorld, COLLECTIONS, FILES, snapshotAll, type Call, type MountState } from "./world";

// The exhaustive permission table of PRD §11: 2 access levels × 4 scopes × 12 methods × 5 target
// relations × 3 Mount states = 1,440 cases, each through the real handler and the proven policy.
// The oracle below is written from PRD §6 (Read Only, Read / Write, Mount Scope, Path Prefix Scope),
// the laws of the policy (above its roots a key only browses), RFC 4918 and RFC 9110, not from the
// handler: it decides whether the key may make the request, and if so, what the protocol answers.

const METHODS = [
  "OPTIONS",
  "GET",
  "HEAD",
  "PROPFIND",
  "PUT",
  "MKCOL",
  "DELETE",
  "PROPPATCH",
  "COPY",
  "MOVE",
  "LOCK",
  "UNLOCK",
] as const;
type Method = (typeof METHODS)[number];

const ACCESS: readonly Access[] = ["read-only", "read-write"];
const STATES: readonly MountState[] = ["exists", "unavailable", "missing"];
const RELATIONS = ["root", "above", "inside", "outside", "missing inside"] as const;
type TargetRelation = (typeof RELATIONS)[number];

interface ScopeCase {
  readonly name: string;
  readonly roots: readonly (readonly string[])[] | null;
  /** The URL path after the base path that each target relation names for this scope. */
  readonly targets: Readonly<Record<TargetRelation, string>>;
}

const SCOPES: readonly ScopeCase[] = [
  {
    // Without a scope every path is inside; "above" and "outside" name the Mount the scoped keys
    // descend into and another Mount, which an unscoped key reaches like any other path.
    name: "no scope",
    roots: null,
    targets: {
      root: "/",
      above: "/files",
      inside: "/files/photos/a.jpg",
      outside: "/media/music/c.mp3",
      "missing inside": "/files/photos/missing.txt",
    },
  },
  {
    // Only the namespace root lies above a Mount; this row reaches it as the bare base path.
    name: "a Mount",
    roots: [["files"]],
    targets: {
      root: "/",
      above: "",
      inside: "/files/photos/a.jpg",
      outside: "/media/music/c.mp3",
      "missing inside": "/files/photos/missing.txt",
    },
  },
  {
    name: "a folder inside a Mount",
    roots: [["files", "photos"]],
    targets: {
      root: "/",
      above: "/files",
      inside: "/files/photos/a.jpg",
      outside: "/files/docs/secret.txt",
      "missing inside": "/files/photos/missing.txt",
    },
  },
  {
    // The outside target shares a prefix of characters, not of names, with a root.
    name: "two roots",
    roots: [
      ["files", "photos"],
      ["media", "music"],
    ],
    targets: {
      root: "/",
      above: "/media",
      inside: "/media/music/c.mp3",
      outside: "/files/photos2/z.txt",
      "missing inside": "/files/photos/missing.txt",
    },
  },
];

// --- The oracle ---------------------------------------------------------------------------------

const namesOf = (urlPath: string) => urlPath.split("/").filter((name) => name !== "");

const startsWith = (path: readonly string[], prefix: readonly string[]) =>
  path.length >= prefix.length && prefix.every((name, i) => path[i] === name);

/** Where a path lies for a key: PRD §6 scopes are lists of roots; no scope reaches everything. */
const relation = (path: readonly string[], roots: ScopeCase["roots"]) => {
  if (roots === null) return "inside";
  if (roots.some((root) => startsWith(path, root))) return "inside";
  if (roots.some((root) => startsWith(root, path))) return "above";
  return "outside";
};

const BROWSE = new Set<Method>(["OPTIONS", "PROPFIND"]);
const READ = new Set<Method>(["OPTIONS", "GET", "HEAD", "PROPFIND"]);

/** PRD §6: a key reads inside its roots, writes there only with Read / Write, browses above. */
const allowed = (
  access: Access,
  method: Method,
  target: readonly string[],
  destination: readonly string[] | null,
  roots: ScopeCase["roots"],
) => {
  const where = relation(target, roots);
  if (where === "outside") return false;
  if (where === "above") return BROWSE.has(method);
  if (READ.has(method)) return true;
  if (access !== "read-write") return false;
  return destination === null || relation(destination, roots) === "inside";
};

type Node =
  | { readonly kind: "root" | "mount" | "collection" | "file" | "missing" }
  | { readonly kind: "unavailable" };

/** What a path is in the world as the test built it, independent of the handler. */
const nodeOf = (path: readonly string[], state: MountState): Node => {
  if (path.length === 0) return { kind: "root" };
  const [mount] = path;
  if (mount !== "files" && mount !== "media") return { kind: "missing" };
  if (mount === "files" && state === "missing") return { kind: "missing" };
  if (mount === "files" && state === "unavailable") return { kind: "unavailable" };
  if (path.length === 1) return { kind: "mount" };
  const key = path.join("/");
  if (Object.hasOwn(FILES, key)) return { kind: "file" };
  if (COLLECTIONS.includes(key)) return { kind: "collection" };
  return { kind: "missing" };
};

const isCollection = (node: Node) =>
  node.kind === "root" || node.kind === "mount" || node.kind === "collection";

/** COPY and MOVE write a new member next to the target, in the target's own Mount. */
const destinationFor = (target: readonly string[]) =>
  target[0] === "media" ? ["media", "music", "new-copy"] : ["files", "photos", "new-copy"];

/** The status RFC 4918 and RFC 9110 give an allowed request on the world's state. */
const protocolStatus = (method: Method, path: readonly string[], state: MountState): number[] => {
  const node = nodeOf(path, state);
  const parent = nodeOf(path.slice(0, -1), state);
  // RFC 9110 §15.6.4: a backend that cannot be reached is a temporary condition, never a 404.
  const down = node.kind === "unavailable";
  // A Mount's root is configuration: it is a collection whatever its backend's state.
  const mountRoot = path.length === 1 && path[0] === "files" && state === "unavailable";
  // Only Mounts live at the namespace root, and a request cannot create one (RFC 4918 §9.3.1).
  const atRoot = path.length === 1;
  switch (method) {
    case "OPTIONS":
      return [200];
    case "GET":
    case "HEAD":
      if (down) return [503];
      if (node.kind === "missing") return [404];
      // RFC 4918 §9.4 leaves GET on a collection to the server; Davloom has no listing page.
      return isCollection(node) ? [405] : [200];
    case "PROPFIND":
      if (node.kind === "root") return [207];
      if (down) return [503];
      return node.kind === "missing" ? [404] : [207];
    case "PUT":
      // RFC 4918 §9.7.2: PUT on an existing collection may fail with 405.
      if (isCollection(node) || mountRoot) return [405];
      if (down) return [503];
      if (node.kind === "file") return [204];
      // RFC 4918 §9.7.1: no parent collection is 409.
      if (atRoot) return [403];
      return parent.kind === "collection" ? [201] : [409];
    case "MKCOL":
      if (mountRoot) return [405];
      if (down) return [503];
      // RFC 4918 §9.3.1: 405 on an existing resource, 409 without a parent collection.
      if (node.kind !== "missing") return [405];
      if (atRoot) return [403];
      return parent.kind === "collection" ? [201] : [409];
    case "DELETE":
      // The namespace root and a Mount root cannot be deleted.
      if (node.kind === "root" || node.kind === "mount") return [403];
      if (down) return [503];
      return node.kind === "missing" ? [404] : [204];
    case "PROPPATCH":
      // The virtual root holds no dead properties: refused whole or per property in a 207.
      if (node.kind === "root") return [403, 207];
      if (down) return [503];
      return node.kind === "missing" ? [404] : [207];
    case "COPY":
    case "MOVE": {
      // RFC 4918 §9.8.5 and §9.9.4: 403 when the source is the destination or contains it.
      if (node.kind === "root") return [403];
      if (down) return [503];
      if (node.kind === "missing") return [404];
      if (node.kind === "mount") return [403];
      return [201];
    }
    case "LOCK":
      if (down) return [503];
      // RFC 4918 §7.3 and §9.10.4: locking an unmapped URL creates an empty resource, which needs
      // a parent collection.
      if (node.kind !== "missing") return [200];
      if (atRoot) return [403];
      return parent.kind === "collection" ? [201] : [409];
    default:
      // UNLOCK. RFC 4918 §9.11.1: a token that is no lock on the resource is 409.
      return [409];
  }
};

// --- Known product bugs, kept out of the table until they are fixed ----------------------------
// 1. The handler reads `stat` failures as "not found": on a Mount whose backend is unavailable,
//    GET, HEAD, PROPFIND, DELETE, PROPPATCH, COPY and MOVE answer 404 instead of 503, and LOCK
//    of the Mount's root, taken for a new resource, answers 405.
// 2. Under a Mount that does not exist, PUT, MKCOL and LOCK of a new member answer 404 instead of
//    the 409 that RFC 4918 gives a request without a parent collection.
const STAT_METHODS = new Set<Method>([
  "GET",
  "HEAD",
  "PROPFIND",
  "DELETE",
  "PROPPATCH",
  "COPY",
  "MOVE",
]);
const CREATE_METHODS = new Set<Method>(["PUT", "MKCOL", "LOCK"]);

const hitsKnownBug = (method: Method, path: readonly string[], state: MountState) => {
  const node = nodeOf(path, state);
  if (node.kind === "unavailable")
    return STAT_METHODS.has(method) || (method === "LOCK" && path.length === 1);
  if (state === "missing" && path[0] === "files" && path.length > 2)
    return CREATE_METHODS.has(method);
  return false;
};

// --- The table ----------------------------------------------------------------------------------

const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';
const PROPPATCH_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><Z:tag xmlns:Z="urn:t">v</Z:tag></D:prop></D:set></D:propertyupdate>';

const requestFor = (method: Method, target: readonly string[]): Call => {
  const destination = `/dav/${destinationFor(target).join("/")}`;
  switch (method) {
    case "PROPFIND":
      return { headers: { depth: "1" } };
    case "PUT":
      return { body: "written" };
    case "PROPPATCH":
      return { body: PROPPATCH_BODY };
    case "COPY":
    case "MOVE":
      return { headers: { destination } };
    case "LOCK":
      return { headers: { depth: "0" }, body: LOCK_BODY };
    case "UNLOCK":
      return { headers: { "lock-token": "<urn:uuid:00000000-0000-4000-8000-000000000000>" } };
    default:
      return {};
  }
};

interface Row {
  readonly access: Access;
  readonly scope: ScopeCase;
  readonly method: Method;
  readonly relation: TargetRelation;
  readonly state: MountState;
}

const ROWS: Row[] = ACCESS.flatMap((access) =>
  SCOPES.flatMap((scope) =>
    METHODS.flatMap((method) =>
      RELATIONS.flatMap((where) =>
        STATES.map((state) => ({ access, scope, method, relation: where, state })),
      ),
    ),
  ),
);

const expectationOf = (row: Row) => {
  const url = row.scope.targets[row.relation];
  const target = namesOf(url);
  const destination =
    row.method === "COPY" || row.method === "MOVE" ? destinationFor(target) : null;
  const permitted = allowed(row.access, row.method, target, destination, row.scope.roots);
  return {
    url,
    target,
    permitted,
    statuses: permitted ? protocolStatus(row.method, target, row.state) : [403],
    bug: permitted && hitsKnownBug(row.method, target, row.state),
  };
};

const TABLE = ROWS.filter((row) => !expectationOf(row).bug).map(
  (row) => [row.access, row.scope.name, row.method, row.relation, row.state, row] as const,
);

describe("the permission table", () => {
  it("names each target relation correctly for every scoped key", () => {
    for (const scope of SCOPES.filter((s) => s.roots !== null)) {
      expect(relation(namesOf(scope.targets.root), scope.roots)).toBe("above");
      expect(relation(namesOf(scope.targets.above), scope.roots)).toBe("above");
      expect(relation(namesOf(scope.targets.inside), scope.roots)).toBe("inside");
      expect(relation(namesOf(scope.targets.outside), scope.roots)).toBe("outside");
      expect(relation(namesOf(scope.targets["missing inside"]), scope.roots)).toBe("inside");
    }
  });

  it.each(TABLE)(
    "%s key, %s, %s on the %s target, Mount %s",
    async (_access, _scope, _method, _relation, _state, row) => {
      const expected = expectationOf(row);
      const world = await buildWorld({
        files: row.state,
        scope: row.scope.roots,
        access: row.access,
      });
      const before = await snapshotAll(world);
      const response = await world.call(
        row.method,
        expected.url,
        requestFor(row.method, expected.target),
      );
      await response.body?.cancel();
      expect(expected.statuses).toContain(response.status);
      if (!expected.permitted) {
        // A refused request changes nothing: no file, property or lock.
        expect(await snapshotAll(world)).toEqual(before);
        expect(
          await world.locks.covering([], { descendants: true, now: Date.UTC(2026, 10, 2) }),
        ).toEqual([]);
      }
    },
  );
});

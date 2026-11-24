// What a write lock protects (RFC 4918 §7, §7.5). An exclusive lock on the collection /c protects
// its properties and its membership: adding, removing or moving a member in or out. With Depth
// infinity it also protects every member's content, properties and membership. Reading, and copying
// out, are never blocked. A request that changes a protected resource needs the lock token in a
// true If header (§10.4.1), here a tagged list naming /c; without it the answer is 423 and nothing
// changes. An If header that is false is 412 (§10.4.1) on every method. lock-protection.test.ts
// runs the table in process, and tests/integration/compat/http/protocol-tables.test.ts over HTTP
// against real servers.

export const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';
const PATCH =
  '<?xml version="1.0" encoding="utf-8"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><Z:p xmlns:Z="urn:z">1</Z:p></D:prop></D:set></D:propertyupdate>';

export type Depth = "0" | "infinity";

export interface Operation {
  readonly label: string;
  readonly method: string;
  readonly path: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly success: number;
  /** Which lock depths on /c protect what the operation changes. */
  readonly protectedBy: readonly Depth[];
}

const both: readonly Depth[] = ["0", "infinity"];
const deep: readonly Depth[] = ["infinity"];
/** A Destination in the world; `@ROOT` stands for the absolute URL of the world's folder. */
const to = (path: string) => ({ destination: `@ROOT${path}` });

export const OPERATIONS: readonly Operation[] = [
  {
    label: "PUT a member's content",
    method: "PUT",
    path: "/c/f.txt",
    body: "x",
    success: 204,
    protectedBy: deep,
  },
  {
    label: "PUT a new member",
    method: "PUT",
    path: "/c/new.txt",
    body: "x",
    success: 201,
    protectedBy: both,
  },
  {
    label: "MKCOL a new member",
    method: "MKCOL",
    path: "/c/newdir",
    success: 201,
    protectedBy: both,
  },
  { label: "DELETE a member", method: "DELETE", path: "/c/f.txt", success: 204, protectedBy: both },
  { label: "DELETE the collection", method: "DELETE", path: "/c", success: 204, protectedBy: both },
  {
    label: "PROPPATCH the collection",
    method: "PROPPATCH",
    path: "/c",
    body: PATCH,
    success: 207,
    protectedBy: both,
  },
  {
    label: "PROPPATCH a member",
    method: "PROPPATCH",
    path: "/c/f.txt",
    body: PATCH,
    success: 207,
    protectedBy: deep,
  },
  {
    label: "MOVE a member out",
    method: "MOVE",
    path: "/c/f.txt",
    headers: to("/out/f2.txt"),
    success: 201,
    protectedBy: both,
  },
  {
    label: "MOVE a file in",
    method: "MOVE",
    path: "/out/h.txt",
    headers: to("/c/h.txt"),
    success: 201,
    protectedBy: both,
  },
  {
    label: "MOVE a member within",
    method: "MOVE",
    path: "/c/f.txt",
    headers: to("/c/f2.txt"),
    success: 201,
    protectedBy: both,
  },
  {
    label: "COPY a file in",
    method: "COPY",
    path: "/out/h.txt",
    headers: to("/c/h.txt"),
    success: 201,
    protectedBy: both,
  },
  {
    label: "COPY a member out",
    method: "COPY",
    path: "/c/f.txt",
    headers: to("/out/f2.txt"),
    success: 201,
    protectedBy: [],
  },
  // §9.8.4: overwriting deletes the destination first, which removes a member of /c.
  {
    label: "COPY onto an existing member",
    method: "COPY",
    path: "/out/h.txt",
    headers: to("/c/f.txt"),
    success: 204,
    protectedBy: both,
  },
  {
    label: "PUT a deep member's content",
    method: "PUT",
    path: "/c/d/g.txt",
    body: "x",
    success: 204,
    protectedBy: deep,
  },
  {
    label: "PUT a new deep member",
    method: "PUT",
    path: "/c/d/new.txt",
    body: "x",
    success: 201,
    protectedBy: deep,
  },
  {
    label: "DELETE a member collection",
    method: "DELETE",
    path: "/c/d",
    success: 204,
    protectedBy: both,
  },
  {
    label: "MKCOL outside the lock",
    method: "MKCOL",
    path: "/out/x",
    success: 201,
    protectedBy: [],
  },
  {
    label: "PUT outside the lock",
    method: "PUT",
    path: "/out/h.txt",
    body: "x",
    success: 204,
    protectedBy: [],
  },
];

export type Token = "no token" | "the lock token" | "an unknown token";
export const TOKENS: readonly Token[] = ["no token", "the lock token", "an unknown token"];

/** The If header a case sends, for a world whose folder is at the absolute URL `root`. */
export const ifFor = (token: Token, lockToken: string, root: string): Record<string, string> =>
  token === "no token"
    ? {}
    : token === "the lock token"
      ? { if: `<${root}/c> (<${lockToken}>)` }
      : { if: "(<urn:uuid:22222222-2222-4222-8222-222222222222>)" };

export const TABLE = OPERATIONS.flatMap((operation) =>
  (["0", "infinity"] as const).flatMap((depth) =>
    TOKENS.map((token) => [operation.label, depth, token, operation] as const),
  ),
);

/** The answer RFC 4918 gives a case of TABLE. */
export const statusOf = (operation: Operation, depth: Depth, token: Token) =>
  token === "an unknown token"
    ? 412
    : operation.protectedBy.includes(depth) && token === "no token"
      ? 423
      : operation.success;

/** Fills `@ROOT` in an operation's headers with the absolute URL of the world's folder. */
export const headersOf = (operation: Operation, root: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(operation.headers ?? {}).map(([name, value]) => [
      name,
      value.replace("@ROOT", root),
    ]),
  );

/** The world: /c holds f.txt and d/g.txt, /out holds h.txt. */
export const WORLD: Readonly<Record<string, string>> = {
  "/c/": "",
  "/c/f.txt": "f",
  "/c/d/": "",
  "/c/d/g.txt": "g",
  "/out/": "",
  "/out/h.txt": "h",
};

/**
 * Reading is never blocked by a lock, and UNLOCK takes the token in Lock-Token (§9.11), on any
 * resource the lock covers. Each row gives the status under a Depth 0 and a Depth infinity lock;
 * `@T` stands for the lock token.
 */
export const READS = (["0", "infinity"] as const).flatMap((depth) =>
  (
    [
      ["GET a member", "GET", "/c/f.txt", {}, [200, 200]],
      ["PROPFIND the collection", "PROPFIND", "/c", { depth: "1" }, [207, 207]],
      ["HEAD a deep member", "HEAD", "/c/d/g.txt", {}, [200, 200]],
      ["UNLOCK with the token", "UNLOCK", "/c", { "lock-token": "<@T>" }, [204, 204]],
      [
        "UNLOCK a member with the token",
        "UNLOCK",
        "/c/f.txt",
        { "lock-token": "<@T>" },
        [409, 204],
      ],
      [
        "UNLOCK a deep member with the token",
        "UNLOCK",
        "/c/d/g.txt",
        { "lock-token": "<@T>" },
        [409, 204],
      ],
      [
        "UNLOCK with an unknown token",
        "UNLOCK",
        "/c",
        { "lock-token": "<urn:uuid:33333333-3333-4333-8333-333333333333>" },
        [409, 409],
      ],
      ["UNLOCK without angle brackets", "UNLOCK", "/c", { "lock-token": "@T" }, [400, 400]],
      ["UNLOCK without a token", "UNLOCK", "/c", {}, [400, 400]],
      ["UNLOCK outside the lock", "UNLOCK", "/out", { "lock-token": "<@T>" }, [409, 409]],
    ] as const
  ).map(
    ([label, method, path, headers, statuses]) =>
      [label, depth, method, path, headers, statuses] as const,
  ),
);

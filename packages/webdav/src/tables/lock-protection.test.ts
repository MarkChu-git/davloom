import { describe, expect, it } from "vitest";
import { BASE, ORIGIN, setup } from "../test/harness";
import { snapshot } from "./world";

// What a write lock protects (RFC 4918 §7, §7.5). An exclusive lock on the collection /c protects
// its properties and its membership: adding, removing or moving a member in or out. With Depth
// infinity it also protects every member's content, properties and membership. Reading, and
// copying out, are never blocked. A request that changes a protected resource needs the lock token
// in a true If header (§10.4.1), here a tagged list naming /c; without it the answer is 423 and
// nothing changes. An If header that is false is 412 (§10.4.1) on every method.

const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';
const PATCH =
  '<?xml version="1.0" encoding="utf-8"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><Z:p xmlns:Z="urn:z">1</Z:p></D:prop></D:set></D:propertyupdate>';

type Depth = "0" | "infinity";

interface Operation {
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
const to = (path: string) => ({ destination: `${ORIGIN}${BASE}${path}` });

const OPERATIONS: readonly Operation[] = [
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

type Token = "no token" | "the lock token" | "an unknown token";
const TOKENS: readonly Token[] = ["no token", "the lock token", "an unknown token"];

const world = async (depth: Depth) => {
  const w = setup();
  await w.mkcol("/c");
  await w.put("/c/f.txt", "f");
  await w.mkcol("/c/d");
  await w.put("/c/d/g.txt", "g");
  await w.mkcol("/out");
  await w.put("/out/h.txt", "h");
  const lock = await w.dav("LOCK", "/c", { headers: { depth }, body: LOCK_BODY });
  await lock.body?.cancel();
  const token = (lock.headers.get("lock-token") ?? "").slice(1, -1);
  return { w, token };
};

const ifFor = (token: Token, lockToken: string): Record<string, string> =>
  token === "no token"
    ? {}
    : token === "the lock token"
      ? { if: `<${ORIGIN}${BASE}/c> (<${lockToken}>)` }
      : { if: "(<urn:uuid:22222222-2222-4222-8222-222222222222>)" };

const TABLE = OPERATIONS.flatMap((operation) =>
  (["0", "infinity"] as const).flatMap((depth) =>
    TOKENS.map((token) => [operation.label, depth, token, operation] as const),
  ),
);

describe("what a write lock on /c protects", () => {
  it.each(TABLE)("%s under a Depth %s lock with %s", async (_label, depth, token, operation) => {
    const { w, token: lockToken } = await world(depth);
    const before = await snapshot(w.storage, "");
    const response = await w.dav(operation.method, operation.path, {
      headers: { ...operation.headers, ...ifFor(token, lockToken) },
      body: operation.body,
    });
    const text = await response.text();
    const blocked = operation.protectedBy.includes(depth);
    const status =
      token === "an unknown token"
        ? 412
        : blocked && token === "no token"
          ? 423
          : operation.success;
    expect(response.status).toBe(status);
    if (status === 423) expect(text).toContain("lock-token-submitted");
    if (status >= 400) expect(await snapshot(w.storage, "")).toEqual(before);
  });

  // Reading is never blocked by a lock, and UNLOCK takes the token in Lock-Token (§9.11), on any
  // resource the lock covers. Each row gives the status under a Depth 0 and a Depth infinity lock.
  it.each(
    (["0", "infinity"] as const).flatMap((depth) =>
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
    ),
  )("%s under a Depth %s lock", async (_label, depth, method, path, headers, statuses) => {
    const { w, token } = await world(depth);
    const filled = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name, value.replace("@T", token)]),
    );
    const response = await w.dav(method, path, { headers: filled });
    await response.body?.cancel();
    expect(response.status).toBe(statuses[depth === "0" ? 0 : 1]);
    // An UNLOCK that succeeded removed the lock: the collection takes a new member without a token.
    if (method === "UNLOCK") {
      expect((await w.put("/c/after.txt", "x")).status).toBe(response.status === 204 ? 201 : 423);
    }
  });
});

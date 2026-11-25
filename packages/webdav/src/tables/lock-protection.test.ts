import { describe, expect, it } from "vitest";
import { BASE, ORIGIN, setup } from "../test/harness";
import {
  headersOf,
  ifFor,
  LOCK_BODY,
  OPERATIONS,
  READS,
  statusOf,
  TABLE,
  TOKENS,
  WORLD,
  type Depth,
} from "./lock-protection-cases";
import { snapshot } from "./world";

// What a write lock protects (RFC 4918 §7, §7.5): the table and oracle of lock-protection-cases.ts,
// against the handler.

const world = async (depth: Depth) => {
  const w = setup();
  for (const [path, content] of Object.entries(WORLD)) {
    if (path.endsWith("/")) await w.mkcol(path.slice(0, -1));
    else await w.put(path, content);
  }
  const lock = await w.dav("LOCK", "/c", { headers: { depth }, body: LOCK_BODY });
  await lock.body?.cancel();
  const token = (lock.headers.get("lock-token") ?? "").slice(1, -1);
  return { w, token };
};

describe("what a write lock on /c protects", () => {
  it.each(TABLE)("%s under a Depth %s lock with %s", async (_label, depth, token, operation) => {
    const { w, token: lockToken } = await world(depth);
    const before = await snapshot(w.storage, "");
    const root = `${ORIGIN}${BASE}`;
    const response = await w.dav(operation.method, operation.path, {
      headers: { ...headersOf(operation, root), ...ifFor(token, lockToken, root) },
      body: operation.body,
    });
    const text = await response.text();
    const status = statusOf(operation, depth, token);
    expect(response.status).toBe(status);
    if (status === 423) expect(text).toContain("lock-token-submitted");
    if (status >= 400) expect(await snapshot(w.storage, "")).toEqual(before);
  });

  it.each(READS)(
    "%s under a Depth %s lock",
    async (_label, depth, method, path, headers, statuses) => {
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
    },
  );
});

// The table, written out (RFC 4918 §7, §7.5, §10.4.1): each operation's request, and the status
// the oracle gives it under a Depth 0 and a Depth infinity lock on /c, with no token, the lock
// token and an unknown token; then each read and UNLOCK. A change to an operation or to the oracle
// that moves an answer fails here, not only in the comparison with the handler.
describe("the lock-protection table, written out", () => {
  const root = "https://dav.example/dav";

  it("answers each operation", () => {
    expect(
      OPERATIONS.map((operation) => {
        const request = `${operation.method} ${operation.path} ${JSON.stringify(headersOf(operation, root))} ${operation.body === undefined ? "no body" : `${operation.body.length}-character body`}`;
        const statuses = (["0", "infinity"] as const).map((depth) =>
          TOKENS.map((token) => statusOf(operation, depth, token)).join("/"),
        );
        return `${operation.label}: ${request} -> depth 0 ${statuses[0]}, infinity ${statuses[1]}`;
      }),
    ).toMatchInlineSnapshot(`
      [
        "PUT a member's content: PUT /c/f.txt {} 1-character body -> depth 0 204/204/412, infinity 423/204/412",
        "PUT a new member: PUT /c/new.txt {} 1-character body -> depth 0 423/201/412, infinity 423/201/412",
        "MKCOL a new member: MKCOL /c/newdir {} no body -> depth 0 423/201/412, infinity 423/201/412",
        "DELETE a member: DELETE /c/f.txt {} no body -> depth 0 423/204/412, infinity 423/204/412",
        "DELETE the collection: DELETE /c {} no body -> depth 0 423/204/412, infinity 423/204/412",
        "PROPPATCH the collection: PROPPATCH /c {} 150-character body -> depth 0 423/207/412, infinity 423/207/412",
        "PROPPATCH a member: PROPPATCH /c/f.txt {} 150-character body -> depth 0 207/207/412, infinity 423/207/412",
        "MOVE a member out: MOVE /c/f.txt {"destination":"https://dav.example/dav/out/f2.txt"} no body -> depth 0 423/201/412, infinity 423/201/412",
        "MOVE a file in: MOVE /out/h.txt {"destination":"https://dav.example/dav/c/h.txt"} no body -> depth 0 423/201/412, infinity 423/201/412",
        "MOVE a member within: MOVE /c/f.txt {"destination":"https://dav.example/dav/c/f2.txt"} no body -> depth 0 423/201/412, infinity 423/201/412",
        "COPY a file in: COPY /out/h.txt {"destination":"https://dav.example/dav/c/h.txt"} no body -> depth 0 423/201/412, infinity 423/201/412",
        "COPY a member out: COPY /c/f.txt {"destination":"https://dav.example/dav/out/f2.txt"} no body -> depth 0 201/201/412, infinity 201/201/412",
        "COPY onto an existing member: COPY /out/h.txt {"destination":"https://dav.example/dav/c/f.txt"} no body -> depth 0 423/204/412, infinity 423/204/412",
        "PUT a deep member's content: PUT /c/d/g.txt {} 1-character body -> depth 0 204/204/412, infinity 423/204/412",
        "PUT a new deep member: PUT /c/d/new.txt {} 1-character body -> depth 0 201/201/412, infinity 423/201/412",
        "DELETE a member collection: DELETE /c/d {} no body -> depth 0 423/204/412, infinity 423/204/412",
        "MKCOL outside the lock: MKCOL /out/x {} no body -> depth 0 201/201/412, infinity 201/201/412",
        "PUT outside the lock: PUT /out/h.txt {} 1-character body -> depth 0 204/204/412, infinity 204/204/412",
      ]
    `);
    expect(TABLE).toHaveLength(OPERATIONS.length * 6);
  });

  it("answers each read and UNLOCK", () => {
    expect(
      READS.map(
        ([label, depth, method, path, headers, statuses]) =>
          `${label} (depth ${depth}): ${method} ${path} ${JSON.stringify(headers)} -> ${statuses.join("/")}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "GET a member (depth 0): GET /c/f.txt {} -> 200/200",
        "PROPFIND the collection (depth 0): PROPFIND /c {"depth":"1"} -> 207/207",
        "HEAD a deep member (depth 0): HEAD /c/d/g.txt {} -> 200/200",
        "UNLOCK with the token (depth 0): UNLOCK /c {"lock-token":"<@T>"} -> 204/204",
        "UNLOCK a member with the token (depth 0): UNLOCK /c/f.txt {"lock-token":"<@T>"} -> 409/204",
        "UNLOCK a deep member with the token (depth 0): UNLOCK /c/d/g.txt {"lock-token":"<@T>"} -> 409/204",
        "UNLOCK with an unknown token (depth 0): UNLOCK /c {"lock-token":"<urn:uuid:33333333-3333-4333-8333-333333333333>"} -> 409/409",
        "UNLOCK without angle brackets (depth 0): UNLOCK /c {"lock-token":"@T"} -> 400/400",
        "UNLOCK without a token (depth 0): UNLOCK /c {} -> 400/400",
        "UNLOCK outside the lock (depth 0): UNLOCK /out {"lock-token":"<@T>"} -> 409/409",
        "GET a member (depth infinity): GET /c/f.txt {} -> 200/200",
        "PROPFIND the collection (depth infinity): PROPFIND /c {"depth":"1"} -> 207/207",
        "HEAD a deep member (depth infinity): HEAD /c/d/g.txt {} -> 200/200",
        "UNLOCK with the token (depth infinity): UNLOCK /c {"lock-token":"<@T>"} -> 204/204",
        "UNLOCK a member with the token (depth infinity): UNLOCK /c/f.txt {"lock-token":"<@T>"} -> 409/204",
        "UNLOCK a deep member with the token (depth infinity): UNLOCK /c/d/g.txt {"lock-token":"<@T>"} -> 409/204",
        "UNLOCK with an unknown token (depth infinity): UNLOCK /c {"lock-token":"<urn:uuid:33333333-3333-4333-8333-333333333333>"} -> 409/409",
        "UNLOCK without angle brackets (depth infinity): UNLOCK /c {"lock-token":"@T"} -> 400/400",
        "UNLOCK without a token (depth infinity): UNLOCK /c {} -> 400/400",
        "UNLOCK outside the lock (depth infinity): UNLOCK /out {"lock-token":"<@T>"} -> 409/409",
      ]
    `);
  });

  it("sends the If header of each token", () => {
    expect(TOKENS.map((token) => ifFor(token, "urn:uuid:7", root))).toEqual([
      {},
      { if: "<https://dav.example/dav/c> (<urn:uuid:7>)" },
      { if: "(<urn:uuid:22222222-2222-4222-8222-222222222222>)" },
    ]);
    expect(WORLD).toEqual({
      "/c/": "",
      "/c/f.txt": "f",
      "/c/d/": "",
      "/c/d/g.txt": "g",
      "/out/": "",
      "/out/h.txt": "h",
    });
    expect(LOCK_BODY).toBe(
      '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>',
    );
  });
});

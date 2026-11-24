import { describe, expect, it } from "vitest";
import { BASE, ORIGIN, setup } from "../test/harness";
import {
  headersOf,
  ifFor,
  LOCK_BODY,
  READS,
  statusOf,
  TABLE,
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

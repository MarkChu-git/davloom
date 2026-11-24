import { createMemoryStorage } from "@davloom/core";
import { describe, expect, it } from "vitest";
import { createWebDavHandler } from "../handler";
import { createMemoryLockStore } from "../locks";
import { BASE, ORIGIN } from "../test/harness";
import { allowOf, CLASS_1, CLASS_2, OTHER_METHODS } from "./methods-cases";
import { buildWorld } from "./world";

// Capability advertisement and methods outside the protocol: the table and oracle of
// methods-cases.ts, against the handler.

const handlerWith = (locking: boolean) =>
  createWebDavHandler({
    basePath: BASE,
    storage: createMemoryStorage(),
    ...(locking ? { locks: createMemoryLockStore() } : {}),
  });

describe("methods outside the protocol", () => {
  it.each(OTHER_METHODS)("%s without a key is 405 with the allowed methods", async (method) => {
    const request = new Request(`${ORIGIN}${BASE}/f.txt`, { method });
    expect(request.method).toBe(method);
    const response = await handlerWith(true)(request);
    expect(response.status).toBe(405);
    expect(allowOf(response)).toEqual(CLASS_2.toSorted());
  });

  it.each(OTHER_METHODS)("%s with a Read / Write key is refused by the policy", async (method) => {
    const world = await buildWorld({ scope: null, access: "read-write" });
    const response = await world.call(method, "/files/photos/a.jpg");
    expect(response.status).toBe(403);
  });
});

describe("capabilities", () => {
  it.each([
    [true, "1, 2", CLASS_2],
    [false, "1", CLASS_1],
  ] as const)("with locking %s, OPTIONS advertises DAV %j", async (locking, dav, methods) => {
    for (const path of ["/", "/missing", "/x/y/z"]) {
      const response = await handlerWith(locking)(
        new Request(`${ORIGIN}${BASE}${path}`, { method: "OPTIONS" }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("dav")).toBe(dav);
      expect(allowOf(response)).toEqual(methods.toSorted());
    }
  });

  it.each(["LOCK", "UNLOCK"])("without locking, %s is 405 and not allowed", async (method) => {
    const response = await handlerWith(false)(
      new Request(`${ORIGIN}${BASE}/f.txt`, { method, headers: { "lock-token": "<urn:x>" } }),
    );
    expect(response.status).toBe(405);
    expect(allowOf(response)).not.toContain(method);
  });

  it.each([
    ["the base path's parent", "/"],
    ["a sibling of the base path", "/davx/f.txt"],
    ["another prefix", "/other/dav/f.txt"],
  ])("a request to %s is not part of the namespace", async (_label, path) => {
    const response = await handlerWith(true)(new Request(`${ORIGIN}${path}`, { method: "GET" }));
    expect(response.status).toBe(404);
  });
});

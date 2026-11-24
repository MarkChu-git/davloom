import { describe, expect, it } from "vitest";
import { REFUSED, refusedByFileStore, type Refuses } from "./names-cases";
import {
  expected,
  OUTSIDE_CONTENT,
  outside,
  PAYLOADS,
  prefixOf,
  requestOf,
  resolve,
  SCOPE,
  TABLE,
} from "./traversal-cases";
import { buildWorld, ORIGIN, snapshotAll } from "./world";

// Path traversal and encoding (PRD §11, §12): the table and oracle of traversal-cases.ts, for a
// Read / Write key limited to /files/photos, against the handler: on a store that keeps every
// valid name, and on one that refuses names as RustFS does on the self-hosted target.

const STORES: readonly (readonly [string, Refuses | undefined])[] = [
  ["a store that keeps every name", undefined],
  ["a store that refuses names as RustFS does", refusedByFileStore],
];

describe("path traversal and encoding", () => {
  it("has 80 or more distinct payloads", () => {
    expect(new Set(PAYLOADS.map(([, payload]) => payload)).size).toBe(PAYLOADS.length);
    expect(PAYLOADS.length).toBeGreaterThanOrEqual(80);
  });

  it("refuses only on a store that refuses the name, where the answer would create it", () => {
    const backslashes = resolve(`${prefixOf(ORIGIN)}..%5cdocs%5csecret.txt`);
    expect(expected("PUT", backslashes)).toEqual([201]);
    expect(expected("PUT", backslashes, refusedByFileStore)).toEqual([201, REFUSED]);
    expect(expected("GET", backslashes, refusedByFileStore)).toEqual([404]);
    const long = resolve(`${prefixOf(ORIGIN)}${"a".repeat(255)}`);
    expect(expected("PUT", long, refusedByFileStore)).toEqual([201]);
    expect(expected("MKCOL", long, refusedByFileStore)).toEqual([201, REFUSED]);
    expect(expected("MKCOL", resolve(`${prefixOf(ORIGIN)}..`), refusedByFileStore)).toEqual([403]);
  });

  describe.each(STORES)("on %s", (_store, refuses) => {
    it.each(TABLE)("%s with %s", async (entry, _label, payload) => {
      const world = await buildWorld({ scope: [SCOPE], access: "read-write", refuses });
      const request = requestOf(entry, payload, ORIGIN);
      const resolved = resolve(`${prefixOf(ORIGIN)}${payload}`);
      const before = await snapshotAll(world);
      const handlerRequest = new Request(request.url, { method: request.method, ...request.init });
      const response = await world.handler(handlerRequest);
      const text = await response.text();
      const allowed = expected(entry, resolved, refuses);
      expect(allowed).toContain(response.status);
      // This store refuses whatever the oracle lets it refuse, so the refusal is seen to happen.
      if (allowed.length > expected(entry, resolved).length) expect(response.status).toBe(REFUSED);
      // Nothing outside the scope is read: no content and no name of a file outside it.
      for (const content of OUTSIDE_CONTENT) expect(text).not.toContain(content);
      expect(text).not.toContain("secret.txt");
      // Nothing outside the scope changes.
      const after = await snapshotAll(world);
      expect(outside(after)).toEqual(outside(before));
      if (response.status >= 400) expect(after).toEqual(before);
    });
  });
});

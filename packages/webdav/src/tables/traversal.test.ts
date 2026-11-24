import { describe, expect, it } from "vitest";
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
// Read / Write key limited to /files/photos, against the handler.

describe("path traversal and encoding", () => {
  it("has 80 or more distinct payloads", () => {
    expect(new Set(PAYLOADS.map(([, payload]) => payload)).size).toBe(PAYLOADS.length);
    expect(PAYLOADS.length).toBeGreaterThanOrEqual(80);
  });

  it.each(TABLE)("%s with %s", async (entry, _label, payload) => {
    const world = await buildWorld({ scope: [SCOPE], access: "read-write" });
    const request = requestOf(entry, payload, ORIGIN);
    const resolved = resolve(`${prefixOf(ORIGIN)}${payload}`);
    const before = await snapshotAll(world);
    const handlerRequest = new Request(request.url, { method: request.method, ...request.init });
    const response = await world.handler(handlerRequest);
    const text = await response.text();
    expect(expected(entry, resolved)).toContain(response.status);
    // Nothing outside the scope is read: no content and no name of a file outside it.
    for (const content of OUTSIDE_CONTENT) expect(text).not.toContain(content);
    expect(text).not.toContain("secret.txt");
    // Nothing outside the scope changes.
    const after = await snapshotAll(world);
    expect(outside(after)).toEqual(outside(before));
    if (response.status >= 400) expect(after).toEqual(before);
  });
});

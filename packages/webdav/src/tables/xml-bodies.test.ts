import { describe, expect, it } from "vitest";
import { DOCUMENTS, EMPTY, EMPTY_BODIES, STATUS, TABLE } from "./xml-bodies-cases";
import { buildWorld } from "./world";

// XML request bodies for PROPFIND, PROPPATCH and LOCK (PRD §11, §12): the table and oracle of
// xml-bodies-cases.ts, against the handler.

const NOW = Date.UTC(2026, 10, 2);

describe("XML request bodies", () => {
  it.each(TABLE)("%s with %s", async (method, _label, body) => {
    const world = await buildWorld({ scope: null, access: "read-write" });
    const text = body.build(DOCUMENTS[method], method);
    const response = await world.call(method, "/files/photos/a.jpg", {
      headers: { depth: "0", "content-type": "application/xml" },
      body: text,
    });
    const reply = await response.text();
    const valid = body.verdict === "valid";
    expect(valid ? [DOCUMENTS[method].success] : STATUS[body.verdict]).toContain(response.status);
    const properties = await world.backends.files.properties([["photos", "a.jpg"]]);
    const stored = properties.ok ? (properties.value["photos/a.jpg"] ?? []) : [];
    const locks = await world.locks.covering(["files", "photos", "a.jpg"], {
      descendants: false,
      now: NOW,
    });
    // Only a valid PROPPATCH stores the property, and only a valid LOCK takes a lock.
    expect(stored.map((p) => p.name)).toEqual(
      valid && method === "PROPPATCH" ? ["{urn:z}note"] : [],
    );
    expect(locks.length).toBe(valid && method === "LOCK" ? 1 : 0);
    // Nothing from a declaration ever comes back.
    expect(reply).not.toContain("boom");
    expect(reply).not.toContain("lollol");
  });

  it.each(EMPTY)("%s with an empty body answers %i", async (method, status) => {
    const world = await buildWorld({ scope: null });
    for (const body of EMPTY_BODIES) {
      const response = await world.call(method, "/files/photos/a.jpg", {
        headers: { depth: "0" },
        body,
      });
      await response.body?.cancel();
      expect(response.status).toBe(status);
    }
  });
});

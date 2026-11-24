import { describe, expect, it } from "vitest";
import { setup } from "../test/harness";
import {
  conflicts,
  covers,
  lockBody,
  TABLE,
  WORLD,
  type Depth,
  type Scope,
} from "./lock-conflicts-cases";

// Lock compatibility (RFC 4918 §6.1, §7, §9.10.6): the table and oracle of lock-conflicts-cases.ts,
// against the handler.

const world = async () => {
  const w = setup();
  for (const [path, content] of Object.entries(WORLD)) {
    if (path.endsWith("/")) await w.mkcol(path.slice(0, -1));
    else await w.put(path, content);
  }
  return w;
};

const lock = (w: Awaited<ReturnType<typeof world>>, path: string, scope: Scope, depth: Depth) =>
  w.dav("LOCK", path, { headers: { depth, timeout: "Second-600" }, body: lockBody(scope) });

describe("lock conflicts", () => {
  it.each(TABLE)(
    "a %s %s lock (Depth %s) then a %s %s lock (Depth %s)",
    async (held, heldScope, heldDepth, wanted, wantedScope, wantedDepth) => {
      const w = await world();
      const first = await lock(w, held, heldScope, heldDepth);
      await first.body?.cancel();
      expect(first.status).toBe(200);
      const second = await lock(w, wanted, wantedScope, wantedDepth);
      const body = await second.text();
      const conflict = conflicts(
        { root: held, scope: heldScope, depth: heldDepth },
        { root: wanted, scope: wantedScope, depth: wantedDepth },
      );
      expect(second.status).toBe(conflict ? 423 : 200);
      if (conflict) {
        expect(body).toContain("no-conflicting-lock");
        expect(second.headers.get("lock-token")).toBeNull();
      } else {
        expect(second.headers.get("lock-token")).toMatch(/^<urn:uuid:[0-9a-f-]{36}>$/);
        expect(second.headers.get("lock-token")).not.toBe(first.headers.get("lock-token"));
      }
      // PROPFIND shows every lock that covers the wanted resource, and only those.
      const discovery = await w.dav("PROPFIND", wanted, {
        headers: { depth: "0" },
        body: '<D:propfind xmlns:D="DAV:"><D:prop><D:lockdiscovery/></D:prop></D:propfind>',
      });
      const xml = await discovery.text();
      const shown = (xml.match(/<D:activelock>/g) ?? []).length;
      const expected = (covers(held, heldDepth, wanted) ? 1 : 0) + (conflict ? 0 : 1);
      expect(shown).toBe(expected);
    },
  );
});

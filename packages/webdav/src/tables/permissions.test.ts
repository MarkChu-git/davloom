import { describe, expect, it } from "vitest";
import { expectationOf, namesOf, relation, requestFor, ROWS, SCOPES } from "./permission-oracle";
import { buildWorld, snapshotAll } from "./world";

// The exhaustive permission table of PRD §11 (permission-oracle.ts), each case through the real
// handler and the proven policy, on memory backends.

const TABLE = ROWS.map(
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

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  decideUnlock,
  ifState,
  lockConflicts,
  lockCovers,
  lockGate,
  lockRefuses,
  type IfClause,
  type IfState,
  type LockDepth,
  type LockGate,
  type LockPlace,
  type LockScope,
} from "./locks";

const SCOPES: readonly LockScope[] = ["exclusive", "shared"];
const DEPTHS: readonly LockDepth[] = ["0", "infinity"];
const STATES: readonly IfState[] = ["no-header", "malformed", "none-true", "some-true"];

// Oracles on real paths, written from RFC 4918 independently of the Bend module.
const within = (path: string[], root: string[]) =>
  root.length <= path.length && root.every((part, i) => path[i] === part);
const placeOf = (root: string[], path: string[]): LockPlace =>
  root.length === path.length && within(path, root)
    ? "same"
    : within(path, root)
      ? "above"
      : within(root, path)
        ? "below"
        : "apart";
const coversPath = (root: string[], depth: LockDepth, path: string[]) =>
  depth === "infinity" ? within(path, root) : root.join("/") === path.join("/");

const holds = (clauses: IfClause[]) =>
  clauses.some((c) => c.resolved && c.conditions.every((x) => x.holds !== x.negated));

const gateOracle = (state: IfState, blocked: boolean): LockGate =>
  state === "malformed"
    ? "bad-header"
    : state === "none-true"
      ? "unmet"
      : blocked
        ? "locked"
        : "proceed";
describe("lock conflicts (RFC 4918 §6.1)", () => {
  it.each([
    ["exclusive", "exclusive", true],
    ["exclusive", "shared", true],
    ["shared", "exclusive", true],
    ["shared", "shared", false],
  ] as const)("a held %s lock and a requested %s lock conflict: %s", (held, wanted, expected) => {
    expect(lockConflicts(held, wanted)).toBe(expected);
  });
});

describe("lock coverage", () => {
  const rows: [LockDepth, LockPlace, boolean, boolean][] = [
    ["0", "same", false, true],
    ["0", "same", true, true],
    ["0", "above", false, false],
    ["0", "above", true, false],
    ["0", "below", false, false],
    ["0", "below", true, true],
    ["0", "apart", true, false],
    ["infinity", "same", false, true],
    ["infinity", "above", false, true],
    ["infinity", "above", true, true],
    ["infinity", "below", false, false],
    ["infinity", "below", true, true],
    ["infinity", "apart", false, false],
    ["infinity", "apart", true, false],
  ];
  it.each(rows)(
    "depth %s, rooted %s, descendants %s: %s",
    (depth, place, descendants, expected) => {
      expect(lockCovers(depth, place, descendants)).toBe(expected);
    },
  );

  const segment = fc.constantFrom("a", "b", "c");
  const path = fc.array(segment, { maxLength: 4 });

  it("agrees with the path oracle for every root, path and depth", () => {
    fc.assert(
      fc.property(
        path,
        path,
        fc.constantFrom(...DEPTHS),
        fc.boolean(),
        (root, target, depth, d) => {
          const expected = coversPath(root, depth, target) || (d && within(root, target));
          expect(lockCovers(depth, placeOf(root, target), d)).toBe(expected);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("refuses a new lock exactly when the two locks overlap and conflict (§9.10.6)", () => {
    fc.assert(
      fc.property(
        path,
        fc.constantFrom(...SCOPES),
        fc.constantFrom(...DEPTHS),
        path,
        fc.constantFrom(...SCOPES),
        fc.constantFrom(...DEPTHS),
        (heldRoot, heldScope, heldDepth, root, scope, depth) => {
          const overlap =
            coversPath(heldRoot, heldDepth, root) || coversPath(root, depth, heldRoot);
          const expected = overlap && !(heldScope === "shared" && scope === "shared");
          expect(
            lockRefuses({ scope: heldScope, depth: heldDepth }, placeOf(heldRoot, root), {
              scope,
              depth,
            }),
          ).toBe(expected);
        },
      ),
      { numRuns: 3000 },
    );
  });
});

describe("If header (RFC 4918 §10.4)", () => {
  it.each([
    ["no header", false, false, [], "no-header"],
    ["no header, even with lists", false, true, [{ resolved: true, conditions: [] }], "no-header"],
    ["malformed", true, false, [], "malformed"],
    ["parsed with no list", true, true, [], "none-true"],
    [
      "one matching token",
      true,
      true,
      [{ resolved: true, conditions: [{ negated: false, holds: true }] }],
      "some-true",
    ],
    [
      "Not of a matching token",
      true,
      true,
      [{ resolved: true, conditions: [{ negated: true, holds: true }] }],
      "none-true",
    ],
    [
      "Not of a token that matches nothing, as in (Not <urn:x>)",
      true,
      true,
      [{ resolved: true, conditions: [{ negated: true, holds: false }] }],
      "some-true",
    ],
    [
      "a list on a resource the request may not see",
      true,
      true,
      [{ resolved: false, conditions: [{ negated: false, holds: true }] }],
      "none-true",
    ],
    [
      "a false list then a true one",
      true,
      true,
      [
        { resolved: true, conditions: [{ negated: false, holds: false }] },
        { resolved: true, conditions: [{ negated: false, holds: true }] },
      ],
      "some-true",
    ],
    [
      "one false condition in a list",
      true,
      true,
      [
        {
          resolved: true,
          conditions: [
            { negated: false, holds: true },
            { negated: false, holds: false },
          ],
        },
      ],
      "none-true",
    ],
  ] as [string, boolean, boolean, IfClause[], IfState][])(
    "%s",
    (_, present, parsed, clauses, expected) => {
      expect(ifState(present, parsed, clauses)).toBe(expected);
    },
  );

  const clause = fc.record({
    resolved: fc.boolean(),
    conditions: fc.array(fc.record({ negated: fc.boolean(), holds: fc.boolean() }), {
      maxLength: 5,
    }),
  });

  it("holds when one list resolves and has no false condition", () => {
    fc.assert(
      fc.property(fc.array(clause, { maxLength: 6 }), (clauses) => {
        expect(ifState(true, true, clauses)).toBe(holds(clauses) ? "some-true" : "none-true");
      }),
      { numRuns: 3000 },
    );
  });

  // workerd's stack overflowed at about 12,000 frames when each list or condition took one.
  it("decides 200,000 lists without running out of stack", () => {
    const many = Array.from({ length: 200_000 }, () => ({
      resolved: true,
      conditions: [{ negated: false, holds: false }],
    }));
    expect(ifState(true, true, many)).toBe("none-true");
  });

  it("decides a list of 200,000 conditions without running out of stack", () => {
    const conditions = Array.from({ length: 200_000 }, () => ({ negated: false, holds: true }));
    expect(ifState(true, true, [{ resolved: true, conditions }])).toBe("some-true");
  });
});

describe("lock gate", () => {
  for (const state of STATES)
    for (const blocked of [false, true])
      it(`${state}, blocked ${blocked}: ${gateOracle(state, blocked)}`, () => {
        expect(lockGate(state, blocked)).toBe(gateOracle(state, blocked));
      });

  it("never lets a blocked request proceed", () => {
    for (const state of STATES) expect(lockGate(state, true)).not.toBe("proceed");
  });
});

describe("UNLOCK", () => {
  it.each([
    [false, false, "not-here"],
    [false, true, "not-here"],
    [true, false, "not-yours"],
    [true, true, "release"],
  ] as const)("found %s, may lock %s: %s", (found, may, expected) => {
    expect(decideUnlock(found, may)).toBe(expected);
  });
});

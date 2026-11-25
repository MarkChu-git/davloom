import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toList } from "./bend";
import bend from "./compiled/imports.mjs";
import { exportHasOwner, planImport, type ImportEntry } from "./imports";

// The oracle replays an import with a Set of the keys defined so far: an entry fails when it needs
// a key the set lacks or defines one the set holds, or one twice.
const oracle = (entries: readonly ImportEntry[], known: readonly string[]): "apply" | "reject" => {
  const defined = new Set(known);
  for (const entry of entries) {
    if (!entry.needs.every((key) => defined.has(key))) return "reject";
    for (const key of entry.defines) {
      if (defined.has(key)) return "reject";
      defined.add(key);
    }
  }
  return "apply";
};

const e = (defines: string[], needs: string[] = []): ImportEntry => ({ defines, needs });

const CASES: readonly (readonly [string, ImportEntry[], string[], "apply" | "reject"])[] = [
  ["nothing into an empty target", [], [], "apply"],
  ["nothing into a full target", [], ["backend:a"], "apply"],
  ["one backend", [e(["backend:a", "backend-name:A"])], [], "apply"],
  ["a backend whose id exists", [e(["backend:a"])], ["backend:a"], "reject"],
  [
    "a backend whose name exists",
    [e(["backend:b", "backend-name:A"])],
    ["backend-name:A"],
    "reject",
  ],
  ["a Mount after its backend", [e(["backend:a"]), e(["mount:m"], ["backend:a"])], [], "apply"],
  ["a Mount before its backend", [e(["mount:m"], ["backend:a"]), e(["backend:a"])], [], "reject"],
  ["a Mount on a backend of the target", [e(["mount:m"], ["backend:a"])], ["backend:a"], "apply"],
  ["a Mount on a missing backend", [e(["mount:m"], ["backend:a"])], [], "reject"],
  ["two backends with one id", [e(["backend:a"]), e(["backend:a"])], [], "reject"],
  ["two backends with one name", [e(["backend:a", "n:A"]), e(["backend:b", "n:A"])], [], "reject"],
  ["an entry that defines a key twice", [e(["backend:a", "backend:a"])], [], "reject"],
  ["an entry that needs its own key", [e(["user:u"], ["user:u"])], [], "reject"],
  ["keys of two kinds with one value", [e(["user:x"]), e(["key:x"], ["user:x"])], [], "apply"],
  ["an entry that needs two keys", [e(["a"]), e(["b"]), e(["c"], ["a", "b"])], [], "apply"],
  ["an entry that needs one of two missing", [e(["a"]), e(["c"], ["a", "b"])], [], "reject"],
  ["an entry that defines nothing", [e([], ["backend:a"])], ["backend:a"], "apply"],
  ["the last entry fails", [e(["a"]), e(["b"]), e(["a"])], [], "reject"],
];

describe("planImport", () => {
  it.each(CASES)("%s", (_, entries, known, expected) => {
    expect(planImport(entries, known)).toBe(expected);
    expect(oracle(entries, known)).toBe(expected);
  });

  const key = fc.constantFrom("a", "b", "c", "d", "e", "f");
  const entry = fc.record({
    defines: fc.array(key, { maxLength: 3 }),
    needs: fc.array(key, { maxLength: 2 }),
  });

  it("decides as the oracle does", () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 8 }), fc.array(key, { maxLength: 3 }), (es, k) => {
        expect(planImport(es, k)).toBe(oracle(es, k));
      }),
      { numRuns: 2000 },
    );
  });

  it("applies the entries it was given, in order, or none (import_all_or_nothing)", () => {
    const nat = fc.integer({ min: 0, max: 6 });
    const bendEntry = fc.record({
      defines: fc.array(nat, { maxLength: 3 }),
      needs: fc.array(nat, { maxLength: 2 }),
    });
    fc.assert(
      fc.property(
        fc.array(bendEntry, { maxLength: 8 }),
        fc.array(nat, { maxLength: 3 }),
        (es, k) => {
          const entries = toList(
            es.map((x) => ({
              $: "Entry" as const,
              defines: toList(x.defines),
              needs: toList(x.needs),
            })),
          );
          const plan = bend.plan(entries, toList(k));
          const valid = oracle(
            es.map((x) => ({ defines: x.defines.map(String), needs: x.needs.map(String) })),
            k.map(String),
          );
          expect(plan.$).toBe(valid === "apply" ? "Apply" : "Reject");
          if (plan.$ === "Apply") expect(plan.entries).toEqual(entries);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("plans an export of 50,000 entries without running out of stack", () => {
    const entries = [
      e(["user:u", "backend:b"]),
      ...Array.from({ length: 2000 }, (_, i) => e([`apikey:${i}`], ["user:u"])),
      ...Array.from({ length: 48_000 }, () => e([], ["backend:b"])),
    ];
    expect(planImport(entries, [])).toBe("apply");
    expect(planImport([...entries, e(["apikey:7"])], [])).toBe("reject");
  });

  it("handles an export of thousands of entries", () => {
    const entries = Array.from({ length: 3000 }, (_, i) =>
      i % 2 === 0 ? e([`backend:${i}`]) : e([`mount:${i}`], [`backend:${i - 1}`]),
    );
    expect(planImport(entries, [])).toBe("apply");
    expect(planImport([...entries, e(["backend:0"])], [])).toBe("reject");
  });
});

describe("exportHasOwner", () => {
  it.each([
    [0, 0, false],
    [0, 1, false],
    [0, 3, false],
    [1, 0, false],
    [1, 1, true],
    [1, 2, true],
    [2, 0, false],
    [2, 1, false],
    [2, 2, false],
    [-1, 1, false],
  ])("%i users with %i logins of the owner: %s", (users, logins, expected) => {
    expect(exportHasOwner(users, logins)).toBe(expected);
  });

  it("holds exactly when there is one user with a login", () => {
    fc.assert(
      fc.property(fc.nat(5), fc.nat(5), (users, logins) => {
        expect(exportHasOwner(users, logins)).toBe(users === 1 && logins > 0);
      }),
    );
  });
});

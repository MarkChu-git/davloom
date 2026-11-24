import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  decideCopy,
  decideMkcol,
  decideMove,
  decideRemove,
  decideWrite,
  resumeMove,
  withinLimit,
  type Node,
  type Outcome,
  type TransferFacts,
} from "./transfer";

// The oracle states RFC 4918's rules as a list of checks in priority order, in a different shape
// from the Bend module: §9.7 (PUT), §9.3 (MKCOL), §9.6 (DELETE), §9.8 and §9.9 (COPY and MOVE).
const NODES: readonly Node[] = ["absent", "file", "collection"];
const BOOLS = [false, true] as const;
const exists = (node: Node) => node !== "absent";
const proceed = (replaces: boolean): Outcome => ({ kind: "proceed", replaces });

const writeOracle = (target: Node, parent: Node): Outcome => {
  if (target === "collection") return { kind: "is-collection" };
  if (parent !== "collection") return { kind: "no-parent" };
  return proceed(target === "file");
};

const mkcolOracle = (isRoot: boolean, target: Node, parent: Node): Outcome => {
  if (isRoot || exists(target)) return { kind: "exists" };
  if (parent !== "collection") return { kind: "no-parent" };
  return proceed(false);
};

const removeOracle = (isRoot: boolean, target: Node): Outcome => {
  if (isRoot) return { kind: "root" };
  if (!exists(target)) return { kind: "missing" };
  return proceed(false);
};

const transferOracle = (move: boolean, f: TransferFacts): Outcome => {
  const checks: [boolean, Outcome][] = [
    [move && f.sourceIsRoot, { kind: "root" }],
    [!exists(f.source), { kind: "missing" }],
    [f.inside, { kind: "into-itself" }],
    [f.destinationIsRoot, { kind: "root" }],
    [exists(f.destination) && !f.overwrite, { kind: "exists" }],
    [f.destinationParent !== "collection", { kind: "no-parent" }],
  ];
  return checks.find(([applies]) => applies)?.[1] ?? proceed(exists(f.destination));
};

const writeCases = NODES.flatMap((target) => NODES.map((parent) => [target, parent] as const));
const mkcolCases = BOOLS.flatMap((root) => writeCases.map(([t, p]) => [root, t, p] as const));
const removeCases = BOOLS.flatMap((root) => NODES.map((t) => [root, t] as const));
const transferCases: TransferFacts[] = [];
for (const sourceIsRoot of BOOLS)
  for (const source of NODES)
    for (const inside of BOOLS)
      for (const destinationIsRoot of BOOLS)
        for (const destination of NODES)
          for (const destinationParent of NODES)
            for (const overwrite of BOOLS)
              transferCases.push({
                sourceIsRoot,
                source,
                inside,
                destinationIsRoot,
                destination,
                destinationParent,
                overwrite,
              });

describe("transfer decisions", () => {
  it.each(writeCases)("PUT to %s under %s", (target, parent) => {
    expect(decideWrite(target, parent)).toEqual(writeOracle(target, parent));
  });

  it.each(mkcolCases)("MKCOL root=%s target=%s parent=%s", (root, target, parent) => {
    expect(decideMkcol(root, target, parent)).toEqual(mkcolOracle(root, target, parent));
  });

  it.each(removeCases)("DELETE root=%s target=%s", (root, target) => {
    expect(decideRemove(root, target)).toEqual(removeOracle(root, target));
  });

  it.each(transferCases)("COPY %j", (facts) => {
    expect(decideCopy(facts)).toEqual(transferOracle(false, facts));
  });

  it.each(transferCases)("MOVE %j", (facts) => {
    expect(decideMove(facts)).toEqual(transferOracle(true, facts));
  });

  // RFC 4918's own statements, as a readable table.
  it.each([
    ["PUT creates a new file", decideWrite("absent", "collection"), proceed(false)],
    ["PUT replaces a file", decideWrite("file", "collection"), proceed(true)],
    [
      "PUT without a parent is a conflict (409)",
      decideWrite("absent", "absent"),
      { kind: "no-parent" },
    ],
    [
      "MKCOL on an existing file is 405",
      decideMkcol(false, "file", "collection"),
      { kind: "exists" },
    ],
    ["DELETE of a missing resource is 404", decideRemove(false, "absent"), { kind: "missing" }],
  ] as const)("%s", (_, actual, expected) => {
    expect(actual).toEqual(expected);
  });
});

describe("withinLimit", () => {
  it.each([
    [0, 0, true],
    [0, 400, true],
    [400, 400, true],
    [401, 400, false],
    [1000, 1000, true],
    [1001, 1000, false],
    [5, 0, false],
    [2 ** 50, 1000, false],
    [2 ** 50, 2 ** 49, true],
    [3, 2 ** 52, true],
  ])("%i entries within %i: %s", (count, limit, expected) => {
    expect(withinLimit(count, limit)).toBe(expected);
  });

  it("agrees with <= for any count and limit", () => {
    fc.assert(
      fc.property(fc.nat({ max: 5000 }), fc.nat({ max: 5000 }), (count, limit) => {
        expect(withinLimit(count, limit)).toBe(count <= limit);
      }),
    );
  });

  it.each([
    [-1, 1],
    [1, -1],
    [1.5, 2],
    [Number.NaN, 2],
  ])("refuses %s and %s", (count, limit) => {
    expect(() => withinLimit(count, limit)).toThrow(RangeError);
  });
});

describe("resumeMove", () => {
  it.each([
    [true, "collection", true],
    [true, "file", false],
    [true, "absent", false],
    [false, "collection", false],
    [false, "file", false],
    [false, "absent", false],
  ] as const)("journal %s, destination %s: %s", (journal, destination, expected) => {
    expect(resumeMove(journal, destination)).toBe(expected);
  });
});

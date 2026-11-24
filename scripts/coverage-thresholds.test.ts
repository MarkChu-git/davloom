import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { thresholds } from "../vitest.config";

const root = fileURLToPath(new URL("..", import.meta.url));

// The packages coverage has to measure: each directory under apps/* or packages/* that has a
// package.json or a src directory.
const packageDirs = (): string[] =>
  ["apps", "packages"].flatMap((group) =>
    readdirSync(join(root, group))
      .map((name) => `${group}/${name}`)
      .filter((dir) => ["package.json", "src"].some((entry) => existsSync(join(root, dir, entry)))),
  );

// Coverage measures only `src`, so a package that keeps its code elsewhere, a package without
// thresholds, or thresholds whose package has moved would pass without being measured
// (Decision 9 of add-ci-baseline).
describe("the coverage gate", () => {
  it("finds a src directory in every package", () => {
    expect(packageDirs().filter((dir) => !existsSync(join(root, dir, "src")))).toEqual([]);
  });

  it("has thresholds for every package, and for nothing else", () => {
    expect(new Set(Object.keys(thresholds))).toEqual(
      new Set(packageDirs().map((dir) => `${dir}/src/**`)),
    );
  });
});

// The V1 targets, copied from the Coverage Gates table of PRD §11. Packages the table does not
// name (laws, migrate, storage) have no target; their thresholds still only go up.
const V1_TARGETS: readonly (readonly [string, number, number, number | null])[] = [
  ["packages/webdav/src/**", 95, 90, 95],
  ["packages/core/src/**", 95, 90, 95],
  ["packages/auth/src/**", 90, 85, null],
  ["packages/database/src/**", 90, 85, null],
  ["apps/api/src/**", 80, 75, null],
  ["apps/web/src/**", 80, 75, null],
  ["packages/ui/src/**", 80, 75, null],
];

const thresholdOf = (glob: string): Partial<Record<"lines" | "branches" | "functions", number>> =>
  Object.entries(thresholds).find(([key]) => key === glob)?.[1] ?? {};

describe("the V1 coverage targets", () => {
  it.each(V1_TARGETS)(
    "%s gates lines at %i%%, branches at %i%% and functions at %s%%",
    (glob, lines, branches, functions) => {
      const threshold = thresholdOf(glob);
      expect(threshold.lines ?? 0).toBeGreaterThanOrEqual(lines);
      expect(threshold.branches ?? 0).toBeGreaterThanOrEqual(branches);
      if (functions !== null) expect(threshold.functions ?? 0).toBeGreaterThanOrEqual(functions);
    },
  );
});

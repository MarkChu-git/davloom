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

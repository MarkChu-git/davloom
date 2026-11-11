import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { thresholds } from "../vitest.config";

const root = fileURLToPath(new URL("..", import.meta.url));

// The sources that coverage measures, one `<group>/<package>/src` directory per package.
const sourceDirs = (): string[] =>
  ["apps", "packages"].flatMap((group) =>
    readdirSync(join(root, group))
      .map((name) => `${group}/${name}/src`)
      .filter((dir) => existsSync(join(root, dir))),
  );

describe("coverage thresholds", () => {
  // A package without thresholds, or thresholds whose package has moved, would pass without
  // being measured (Decision 9 of add-ci-baseline), so both sides have to name the same packages.
  it("name every package that has sources, and nothing else", () => {
    expect(new Set(Object.keys(thresholds))).toEqual(
      new Set(sourceDirs().map((dir) => `${dir}/**`)),
    );
  });
});

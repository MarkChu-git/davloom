import { describe, expect, it } from "vitest";
import { findPinViolations } from "./pinned-deps";

describe("findPinViolations", () => {
  it("accepts exact versions", () => {
    const manifests = { "a/package.json": { dependencies: { "@astryxdesign/core": "0.7.8" } } };
    expect(findPinViolations(manifests)).toEqual([]);
  });

  it.each(["^0.7.8", "~0.7.8", ">=0.7.8", "*", "latest"])("rejects the range %s", (version) => {
    const manifests = { "a/package.json": { devDependencies: { "@stylexjs/unplugin": version } } };
    expect(findPinViolations(manifests)).toHaveLength(1);
  });

  it("ignores other packages", () => {
    const manifests = { "a/package.json": { dependencies: { react: "^19.0.0" } } };
    expect(findPinViolations(manifests)).toEqual([]);
  });
});

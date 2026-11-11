import { describe, expect, it } from "vitest";
import {
  findDesignDependencies,
  findPinViolations,
  findStyleXRangeViolations,
} from "./pinned-deps";

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

describe("findDesignDependencies", () => {
  it("lists each Astryx and StyleX package once, whichever field declares it", () => {
    const manifest = {
      dependencies: {
        "@astryxdesign/core": "0.7.8",
        "@stylexjs/stylex": "0.19.1",
        react: "19.3.1",
      },
      devDependencies: { "@stylexjs/unplugin": "0.19.1" },
      peerDependencies: { "@astryxdesign/core": "0.7.8" },
    };
    expect(findDesignDependencies(manifest)).toEqual([
      "@astryxdesign/core",
      "@stylexjs/stylex",
      "@stylexjs/unplugin",
    ]);
  });
});

describe("findStyleXRangeViolations", () => {
  const core = {
    name: "@astryxdesign/core",
    version: "0.7.8",
    peerDependencies: { "@stylexjs/stylex": "^0.19.0", react: ">=19.0.0" },
  };

  it("accepts StyleX inside the range Astryx declares", () => {
    const installed = [core, { name: "@stylexjs/stylex", version: "0.19.1" }];
    expect(findStyleXRangeViolations(installed)).toEqual([]);
  });

  it("rejects StyleX outside that range and names the range and the installed version", () => {
    const installed = [core, { name: "@stylexjs/stylex", version: "0.20.0" }];
    expect(findStyleXRangeViolations(installed)).toEqual([
      "@stylexjs/stylex is 0.20.0, outside the range ^0.19.0 that @astryxdesign/core 0.7.8 declares for @stylexjs/stylex",
    ]);
  });

  it("holds every StyleX package to the range Astryx declares for @stylexjs/stylex", () => {
    const installed = [
      core,
      { name: "@stylexjs/stylex", version: "0.19.1" },
      { name: "@stylexjs/unplugin", version: "0.20.0" },
    ];
    expect(findStyleXRangeViolations(installed)).toEqual([
      "@stylexjs/unplugin is 0.20.0, outside the range ^0.19.0 that @astryxdesign/core 0.7.8 declares for @stylexjs/stylex",
    ]);
  });

  it("uses the range Astryx declares for a StyleX package when it names that package", () => {
    const astryx = {
      ...core,
      peerDependencies: { "@stylexjs/stylex": "^0.19.0", "@stylexjs/unplugin": "^0.20.0" },
    };
    const installed = [astryx, { name: "@stylexjs/unplugin", version: "0.20.0" }];
    expect(findStyleXRangeViolations(installed)).toEqual([]);
  });

  it("rejects a pre-release of a version inside the range", () => {
    const installed = [core, { name: "@stylexjs/stylex", version: "0.19.2-beta.0" }];
    expect(findStyleXRangeViolations(installed)).toHaveLength(1);
  });

  it("ignores Astryx packages that declare no StyleX range", () => {
    const theme = {
      name: "@astryxdesign/theme-neutral",
      version: "0.7.8",
      peerDependencies: { "@astryxdesign/core": "0.7.8" },
    };
    const installed = [theme, { name: "@stylexjs/stylex", version: "0.20.0" }];
    expect(findStyleXRangeViolations(installed)).toEqual([]);
  });
});

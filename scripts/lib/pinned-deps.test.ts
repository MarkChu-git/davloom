import { describe, expect, it } from "vitest";
import {
  findDesignDependencies,
  findInstallViolations,
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
  it("gives the declared version of each Astryx and StyleX package once, whichever field declares it", () => {
    const manifest = {
      dependencies: {
        "@astryxdesign/core": "0.7.8",
        "@stylexjs/stylex": "0.19.1",
        react: "19.3.1",
      },
      devDependencies: { "@stylexjs/unplugin": "0.19.1" },
      peerDependencies: { "@astryxdesign/core": "0.7.8" },
    };
    expect(findDesignDependencies(manifest)).toEqual({
      "@astryxdesign/core": "0.7.8",
      "@stylexjs/stylex": "0.19.1",
      "@stylexjs/unplugin": "0.19.1",
    });
  });
});

describe("findInstallViolations", () => {
  const install = { path: "apps/web/package.json", name: "@stylexjs/stylex", declared: "0.20.0" };

  it("accepts a package installed at the version its manifest declares", () => {
    const installed = { name: "@stylexjs/stylex", version: "0.20.0" };
    expect(findInstallViolations([{ ...install, installed }])).toEqual([]);
  });

  it("rejects a declared package that is not installed", () => {
    expect(findInstallViolations([{ ...install, installed: undefined }])).toEqual([
      "apps/web/package.json: @stylexjs/stylex is not installed; run bun install",
    ]);
  });

  it("rejects a package installed at another version than its manifest declares", () => {
    const installed = { name: "@stylexjs/stylex", version: "0.19.1" };
    expect(findInstallViolations([{ ...install, installed }])).toEqual([
      "apps/web/package.json: @stylexjs/stylex is declared as 0.20.0 but 0.19.1 is installed; run bun install",
    ]);
  });

  it("leaves a declared range to the pin check", () => {
    const installed = { name: "@stylexjs/stylex", version: "0.19.1" };
    expect(findInstallViolations([{ ...install, declared: "^0.19.0", installed }])).toEqual([]);
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

  // The check reads a subset of npm range syntax, so npm forms outside it, such as a space after
  // the operator, `~>` or an empty range, fail like ranges npm cannot read either. Versions follow
  // npm's grammar, where Bun is looser: a suffix needs three numbers, nothing but wildcards follows
  // a wildcard, numbers have no leading zero and stay safe integers, and identifiers are not empty.
  it.each([
    "latest",
    "workspace:^0.19.0",
    "npm:@stylexjs/stylex@^0.19.0",
    "garbage!!",
    "",
    ">= 0.19.0",
    "~>0.19.0",
    "- 0.19.0",
    "0.19.0 -",
    ">=0.19.0 - <0.20.0",
    "*-beta",
    "x+1",
    "0.19-beta",
    "*.19.0",
    "00.19.0",
    "<999999999999999999.0.0",
    "0.19.0-beta..1",
    "0.19.0\t-\t0.19.5",
  ])(
    "rejects the range %j, which this check does not read, once for all StyleX packages",
    (range) => {
      const astryx = { ...core, peerDependencies: { "@stylexjs/stylex": range } };
      const installed = [
        astryx,
        { name: "@stylexjs/stylex", version: "0.19.1" },
        { name: "@stylexjs/unplugin", version: "0.19.1" },
      ];
      expect(findStyleXRangeViolations(installed)).toEqual([
        `@astryxdesign/core 0.7.8 declares ${JSON.stringify(range)} for @stylexjs/stylex, which is not a version range this check can read`,
      ]);
    },
  );

  it.each([
    ">=0.19.0 <0.20.0",
    "0.19.0 - 0.19.5",
    "0.19.x - 0.20.x",
    ">=0.19.0-0 <0.20.0",
    "^0.18.0 || ^0.19.0",
    "~0.19",
    "0.19.x",
    "*",
  ])("reads the range %s", (range) => {
    const astryx = { ...core, peerDependencies: { "@stylexjs/stylex": range } };
    expect(
      findStyleXRangeViolations([astryx, { name: "@stylexjs/stylex", version: "0.19.1" }]),
    ).toEqual([]);
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

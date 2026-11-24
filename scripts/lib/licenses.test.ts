import { describe, expect, it } from "vitest";
import {
  ALLOWED,
  isInstalledDependency,
  isSatisfied,
  licenseFindings,
  licenseProblem,
  parseExpression,
  type SbomPackage,
} from "./licenses";

// The expected values come from the SPDX specification's expression grammar (Annex D: AND binds
// tighter than OR, WITH attaches an exception to one license) and from which licenses the policy
// in licenses.ts names, never from what the code returns.

const installed = (name: string, ...licenses: string[]): SbomPackage => ({
  name,
  version: "1.0.0",
  type: "npm",
  licenses: licenses.map((value) => ({ value, spdxExpression: value })),
  locations: [{ path: `/app/node_modules/.bun/x@1.0.0/node_modules/${name}/package.json` }],
});

const at = (name: string, path: string, type = "npm"): SbomPackage => ({
  name,
  version: "1.0.0",
  type,
  locations: [{ path }],
});

describe("SPDX expressions", () => {
  it.each([
    ["MIT", { kind: "license", id: "MIT" }],
    ["(MIT)", { kind: "license", id: "MIT" }],
    [
      "MIT OR Apache-2.0",
      {
        kind: "or",
        left: { kind: "license", id: "MIT" },
        right: { kind: "license", id: "Apache-2.0" },
      },
    ],
    [
      "MIT AND ISC OR GPL-3.0-only",
      {
        kind: "or",
        left: {
          kind: "and",
          left: { kind: "license", id: "MIT" },
          right: { kind: "license", id: "ISC" },
        },
        right: { kind: "license", id: "GPL-3.0-only" },
      },
    ],
    [
      "MIT AND (ISC OR GPL-3.0-only)",
      {
        kind: "and",
        left: { kind: "license", id: "MIT" },
        right: {
          kind: "or",
          left: { kind: "license", id: "ISC" },
          right: { kind: "license", id: "GPL-3.0-only" },
        },
      },
    ],
    [
      "GPL-2.0-only WITH Classpath-exception-2.0",
      { kind: "license", id: "GPL-2.0-only WITH Classpath-exception-2.0" },
    ],
    [
      "mit or apache-2.0",
      {
        kind: "or",
        left: { kind: "license", id: "mit" },
        right: { kind: "license", id: "apache-2.0" },
      },
    ],
  ])("%s parses as SPDX groups it", (text, expected) => {
    expect(parseExpression(text)).toEqual(expected);
  });

  it.each(["", "(", "MIT OR", "AND MIT", "(MIT", "MIT)", "MIT WITH", "MIT OR OR ISC", "MIT ISC"])(
    "%j is not an expression",
    (text) => {
      expect(parseExpression(text)).toBeNull();
    },
  );

  const policy = new Set(["MIT", "ISC"]);
  it.each([
    ["MIT", true],
    ["GPL-3.0-only", false],
    ["MIT OR GPL-3.0-only", true],
    ["GPL-3.0-only OR MIT", true],
    ["MIT AND ISC", true],
    ["MIT AND GPL-3.0-only", false],
    ["(MIT AND GPL-3.0-only) OR ISC", true],
    ["MIT AND (GPL-3.0-only OR AGPL-3.0-only)", false],
    ["MIT WITH Some-exception", false],
  ])("%s is satisfied by MIT and ISC: %s", (text, expected) => {
    const expression = parseExpression(text);
    expect(expression).not.toBeNull();
    if (expression) expect(isSatisfied(expression, policy)).toBe(expected);
  });
});

describe("the license policy", () => {
  it.each([
    "MIT",
    "ISC",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "0BSD",
    "MPL-2.0",
    "LGPL-3.0-or-later",
    "CC0-1.0",
    "Unlicense",
    "BlueOak-1.0.0",
    "Python-2.0",
    "CC-BY-4.0",
  ])("allows %s", (license) => {
    expect(ALLOWED.has(license)).toBe(true);
    expect(licenseProblem(installed("dep", license))).toBeNull();
  });

  it.each([
    "GPL-2.0-only",
    "GPL-3.0-or-later",
    "AGPL-3.0-only",
    "SSPL-1.0",
    "BUSL-1.1",
    "CC-BY-NC-4.0",
    "Elastic-2.0",
    "UNLICENSED",
    "SEE LICENSE IN LICENSE.md",
  ])("refuses %s", (license) => {
    expect(ALLOWED.has(license)).toBe(false);
    expect(licenseProblem(installed("dep", license))).not.toBeNull();
  });

  it.each([
    [[], "declares no license"],
    [["MIT", "GPL-3.0-only"], "is under GPL-3.0-only, which is not allowed"],
    [["MIT OR GPL-3.0-only"], null],
    [["Apache 2.0"], 'declares "Apache 2.0", which is not an SPDX expression'],
    [["  "], "declares no license"],
  ] as const)("a package declaring %j: %s", (licenses, expected) => {
    expect(licenseProblem(installed("dep", ...licenses))).toBe(expected);
  });

  it("reads the plain value when Syft found no SPDX expression", () => {
    expect(
      licenseProblem({ ...installed("dep"), licenses: [{ value: "MIT", spdxExpression: "" }] }),
    ).toBeNull();
  });
});

describe("which packages the check covers", () => {
  it.each([
    ["an installed package", at("left-pad", "/app/node_modules/left-pad/package.json"), true],
    [
      "a scoped package in Bun's store",
      at("@scope/pkg", "/app/node_modules/.bun/@scope+pkg@1/node_modules/@scope/pkg/package.json"),
      true,
    ],
    ["a Davloom workspace", at("@davloom/api", "/app/apps/api/package.json"), false],
    ["the repository root", at("davloom", "/app/package.json"), false],
    [
      "a subpath manifest inside a package",
      at("rxjs/ajax", "/app/node_modules/rxjs/ajax/package.json"),
      false,
    ],
    [
      "an example app bundled in a package",
      at("docs", "/app/node_modules/jscodeshift/website/package.json"),
      false,
    ],
    ["a Debian package", at("bash", "/var/lib/dpkg/status", "deb"), false],
    ["a Go module inside a binary", at("golang.org/x/sys", "/app/esbuild", "go-module"), false],
  ])("%s: %s", (_what, pkg, expected) => {
    expect(isInstalledDependency(pkg)).toBe(expected);
  });

  it("reports each failing installed package once, sorted, and nothing else", () => {
    const packages = [
      installed("zeta", "GPL-3.0-only"),
      installed("alpha"),
      installed("fine", "MIT"),
      installed("zeta", "GPL-3.0-only"),
      at("@davloom/core", "/app/packages/core/package.json"),
    ];
    expect(licenseFindings(packages)).toEqual([
      "alpha@1.0.0 declares no license",
      "zeta@1.0.0 is under GPL-3.0-only, which is not allowed",
    ]);
  });
});

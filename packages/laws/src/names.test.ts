import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isValidName, isValidPath } from "./names";

// The oracle counts bytes with the platform's UTF-8 encoder, and finds lone surrogates with
// String.prototype.isWellFormed.
const utf8 = (s: string) => new TextEncoder().encode(s).length;
const nameOracle = (name: string) =>
  name.length > 0 &&
  name !== "." &&
  name !== ".." &&
  !name.includes("/") &&
  !name.includes("\0") &&
  !/\p{Surrogate}/u.test(name) &&
  utf8(name) <= 255;
const pathOracle = (names: string[]) =>
  names.every(nameOracle) && names.reduce((sum, name) => sum + 1 + utf8(name), 0) <= 900;

describe("names", () => {
  it.each([
    ["a", true],
    ["file.txt", true],
    ["...", true],
    [".hidden", true],
    ["..x", true],
    ["中文名", true],
    ["😀", true],
    ["a b", true],
    ["a\\b", true],
    ["", false],
    [".", false],
    ["..", false],
    ["a/b", false],
    ["/", false],
    ["a\0b", false],
    ["\uD800", false],
    ["x\uDFFFy", false],
    ["a".repeat(255), true],
    ["a".repeat(256), false],
    ["é".repeat(127), true],
    ["é".repeat(128), false],
    ["中".repeat(85), true],
    ["中".repeat(86), false],
    ["😀".repeat(63), true],
    ["😀".repeat(64), false],
    ["x".repeat(100_000), false],
  ])("isValidName(%j) is %s", (name, expected) => {
    expect(isValidName(name)).toBe(expected);
  });

  it.each([
    [[], true],
    [["a"], true],
    [["a", "b", "c"], true],
    [["a", ".."], false],
    [["a", ""], false],
    [Array(450).fill("a"), true],
    [Array(451).fill("a"), false],
    [Array(4).fill("a".repeat(224)), true],
    [Array(4).fill("a".repeat(225)), false],
  ])("isValidPath(%j) is %s", (names, expected) => {
    expect(isValidPath(names)).toBe(expected);
  });

  it("accepts_valid_names: the module accepts a name exactly when the oracle does", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: "grapheme" }),
          fc.string({ unit: "binary" }),
          fc.constantFrom(".", "..", "/"),
        ),
        (name) => {
          expect(isValidName(name)).toBe(nameOracle(name));
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("accepts_valid_paths: the module accepts a path exactly when the oracle does", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: "binary", maxLength: 300 }), { maxLength: 8 }),
        (names) => {
          expect(isValidPath(names)).toBe(pathOracle(names));
        },
      ),
    );
  });
});

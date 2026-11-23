import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toList } from "./bend";
import bend from "./compiled/names.mjs";
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

// The laws' statements over code points, checked against the compiled module. The width follows
// RFC 3629 §3 and is written apart from both the module and the platform's encoder.
const width = (c: number) => (c <= 0x7f ? 1 : c <= 0x7ff ? 2 : c <= 0xffff ? 3 : 4);
const bytes = (cps: readonly number[]) => cps.reduce((sum, c) => sum + width(c), 0);
const nameOk = (cps: readonly number[]) => bend.name_ok(toList(cps));
const pathOk = (names: readonly (readonly number[])[]) =>
  bend.path_ok(toList(names.map((cps) => toList(cps))));
const codePoint = fc.oneof(
  fc.integer({ min: 1, max: 0x7f }),
  fc.integer({ min: 0, max: 0x10ffff + 16 }),
  fc.constantFrom(0, 46, 47, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xd800, 0xdfff, 0xe000, 0xffff),
  fc.constantFrom(0x10000, 0x10ffff, 0x110000),
);
const codePoints = (maxLength: number) => fc.array(codePoint, { maxLength });
const allowed = (c: number) =>
  c !== 0 && c !== 47 && !(c >= 0xd800 && c <= 0xdfff) && c <= 0x10ffff;
const dots = (cps: readonly number[]) =>
  (cps.length === 1 || cps.length === 2) && cps.every((c) => c === 46);
const specNameOk = (cps: readonly number[]) =>
  cps.length > 0 && !dots(cps) && cps.every(allowed) && bytes(cps) <= 255;

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

  it("name_rejects_dots: neither . nor .. is a name", () => {
    expect(nameOk([46])).toBe(false);
    expect(nameOk([46, 46])).toBe(false);
  });

  it("name_rejects_separators: a name holding NUL or / is never accepted", () => {
    fc.assert(
      fc.property(
        codePoints(40),
        fc.constantFrom(0, 47),
        codePoints(40),
        (before, separator, after) => !nameOk([...before, separator, ...after]),
      ),
      { numRuns: 2000 },
    );
  });

  it("name_bounded: an accepted name is non-empty and takes at most 255 bytes", () => {
    fc.assert(
      fc.property(
        fc.oneof(codePoints(8), codePoints(300), fc.array(fc.constant(0xe9), { maxLength: 300 })),
        (cps) => !nameOk(cps) || (cps.length > 0 && bytes(cps) <= 255),
      ),
      { numRuns: 2000 },
    );
  });

  it("path_bounded: an accepted path takes at most 900 bytes with a / before each name", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.integer({ min: 1, max: 0x7ff }), { maxLength: 130 }), {
          maxLength: 10,
        }),
        (names) => !pathOk(names) || names.reduce((sum, cps) => sum + 1 + bytes(cps), 0) <= 900,
      ),
    );
  });

  it("name_accepted: the module accepts a name exactly when the specification does", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          codePoints(8),
          codePoints(300),
          fc.array(fc.constantFrom(46, 0x41), { maxLength: 4 }),
          fc.array(fc.constant(0xe9), { maxLength: 300 }),
        ),
        (cps) => {
          expect(nameOk(cps)).toBe(specNameOk(cps));
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

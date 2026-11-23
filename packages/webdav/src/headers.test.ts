import { describe, expect, it } from "vitest";
import {
  parseDepth,
  parseEntityTags,
  parseHttpDate,
  parseOverwrite,
  parseRange,
  toSeconds,
} from "./headers";

// A field value's leading and trailing whitespace is not part of it (RFC 9110 §5.5).
describe("parseDepth (RFC 4918 §10.2)", () => {
  it.each([
    ["0", "0"],
    ["1", "1"],
    ["infinity", "infinity"],
    ["Infinity", "infinity"],
    [" 1 ", "1"],
    ["\tinfinity", "infinity"],
    ["2", null],
    ["", null],
    ["-1", null],
    ["infinite", null],
  ])("Depth: %j is %j", (header, depth) => {
    expect(parseDepth(header)).toBe(depth);
  });

  it("is undefined when the header is absent", () => {
    expect(parseDepth(null)).toBeUndefined();
  });
});

describe("parseOverwrite (RFC 4918 §10.6)", () => {
  it.each([
    [null, true],
    ["T", true],
    ["F", false],
    ["t", true],
    [" f ", false],
    ["", null],
    ["true", null],
    ["X", null],
  ])("Overwrite: %j is %j", (header, overwrite) => {
    expect(parseOverwrite(header)).toBe(overwrite);
  });
});

describe("parseRange (RFC 9110 §14.1.2)", () => {
  it.each([
    // The examples of RFC 9110 §14.1.2.
    ["bytes=0-499", { kind: "from-to", first: 0, last: 499 }],
    ["bytes=500-999", { kind: "from-to", first: 500, last: 999 }],
    ["bytes=-500", { kind: "suffix", length: 500 }],
    ["bytes=9500-", { kind: "from", first: 9500 }],
    ["bytes=0-0", { kind: "from-to", first: 0, last: 0 }],
    // Range units are case-insensitive (RFC 9110 §14.1).
    ["Bytes=1-2", { kind: "from-to", first: 1, last: 2 }],
    [" bytes=1-2 ", { kind: "from-to", first: 1, last: 2 }],
  ])("Range: %j is %j", (header, range) => {
    expect(parseRange(header)).toEqual(range);
  });

  // Anything else is ignored, and the whole representation is sent (RFC 9110 §14.2).
  it.each([
    "bytes=0-0,-1",
    "bytes=500-600,601-999",
    "items=0-1",
    "bytesx=0-1",
    "xbytes=0-1",
    "bytes=5",
    "bytes=",
    "bytes=-",
    "bytes=3-1",
    "bytes=a-1",
    "bytes=1a-",
    "bytes=a1-",
    "bytes=0-1a",
    "bytes=0-a1",
    "bytes=-a1",
    "bytes=-1a",
    "bytes=1.5-2",
  ])("ignores Range: %j", (header) => {
    expect(parseRange(header)).toBeNull();
  });

  it("is null when the header is absent", () => {
    expect(parseRange(null)).toBeNull();
  });
});

describe("parseEntityTags (RFC 9110 §8.8.3, §13.1.1)", () => {
  it.each([
    ['"xyzzy"', [{ weak: false, tag: "xyzzy" }]],
    ['W/"xyzzy"', [{ weak: true, tag: "xyzzy" }]],
    ['""', [{ weak: false, tag: "" }]],
    [
      '"xyzzy", "r2d2xxxx", "c3piozzzz"',
      [
        { weak: false, tag: "xyzzy" },
        { weak: false, tag: "r2d2xxxx" },
        { weak: false, tag: "c3piozzzz" },
      ],
    ],
    [
      '"a" ,W/"b",  "c"',
      [
        { weak: false, tag: "a" },
        { weak: true, tag: "b" },
        { weak: false, tag: "c" },
      ],
    ],
    [' "a" ', [{ weak: false, tag: "a" }]],
  ])("%j is %j", (header, tags) => {
    expect(parseEntityTags(header)).toEqual(tags);
  });

  it.each(["*", " * "])("%j is the wildcard", (header) => {
    expect(parseEntityTags(header)).toBe("*");
  });

  it.each(["xyzzy", '"a" "b"', '"a", b', '"a", "b', 'w/"a"', "", "  ", '"a"junk', '*, "a"'])(
    "%j is malformed",
    (header) => {
      expect(parseEntityTags(header)).toBeNull();
    },
  );
});

describe("parseHttpDate (RFC 9110 §5.6.7)", () => {
  it("reads the IMF-fixdate of RFC 9110's example", () => {
    expect(parseHttpDate("Sun, 06 Nov 1994 08:49:37 GMT")).toBe(Date.UTC(1994, 10, 6, 8, 49, 37));
  });

  it.each([null, "", "not a date"])("is null for %j", (header) => {
    expect(parseHttpDate(header)).toBeNull();
  });

  it.each([
    [0, 0],
    [999, 0],
    [1000, 1],
    [1999, 1],
    [784_111_777_123, 784_111_777],
  ])("toSeconds(%i) is %i", (time, seconds) => {
    expect(toSeconds(time)).toBe(seconds);
  });
});

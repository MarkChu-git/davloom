import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolveRange, type RangeSpec, type Resolved } from "./ranges";

// RFC 9110 §14.1.2 examples for a representation of 10000 bytes.
const RFC_EXAMPLES: [string, RangeSpec, Resolved][] = [
  ["the first 500 bytes", { kind: "from-to", first: 0, last: 499 }, { start: 0, stop: 500 }],
  ["the second 500 bytes", { kind: "from-to", first: 500, last: 999 }, { start: 500, stop: 1000 }],
  ["the final 500 bytes", { kind: "suffix", length: 500 }, { start: 9500, stop: 10000 }],
  ["the final 500 bytes, open-ended", { kind: "from", first: 9500 }, { start: 9500, stop: 10000 }],
  [
    "the first and last bytes only: first",
    { kind: "from-to", first: 0, last: 0 },
    { start: 0, stop: 1 },
  ],
  ["last byte by suffix", { kind: "suffix", length: 1 }, { start: 9999, stop: 10000 }],
  [
    "a last position past the end",
    { kind: "from-to", first: 9000, last: 99999 },
    { start: 9000, stop: 10000 },
  ],
  [
    "a suffix longer than the representation",
    { kind: "suffix", length: 20000 },
    { start: 0, stop: 10000 },
  ],
  ["a first position at the size", { kind: "from-to", first: 10000, last: 10001 }, "unsatisfiable"],
  ["an open range at the size", { kind: "from", first: 10000 }, "unsatisfiable"],
  ["an empty suffix", { kind: "suffix", length: 0 }, "unsatisfiable"],
  ["a huge first position", { kind: "from", first: 2 ** 60 }, "unsatisfiable"],
  ["a huge last position", { kind: "from-to", first: 1, last: 2 ** 60 }, { start: 1, stop: 10000 }],
];

const oracle = (spec: RangeSpec, size: number): Resolved => {
  if (spec.kind === "suffix") {
    if (spec.length === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - spec.length), stop: size };
  }
  if (spec.first >= size) return "unsatisfiable";
  const stop = spec.kind === "from" ? size : Math.min(spec.last + 1, size);
  return { start: spec.first, stop };
};

const nat = fc.integer({ min: 0, max: 2 ** 40 });
const spec: fc.Arbitrary<RangeSpec> = fc.oneof(
  fc
    .tuple(nat, nat)
    .map(([a, b]) => ({ kind: "from-to", first: Math.min(a, b), last: Math.max(a, b) }) as const),
  nat.map((first) => ({ kind: "from", first }) as const),
  nat.map((length) => ({ kind: "suffix", length }) as const),
);

describe("ranges", () => {
  it.each(RFC_EXAMPLES)("%s", (_, range, expected) => {
    expect(resolveRange(range, 10000)).toEqual(expected);
  });

  it.each([
    [{ kind: "suffix", length: 5 }, 0],
    [{ kind: "from", first: 0 }, 0],
    [{ kind: "from-to", first: 0, last: 0 }, 0],
  ] as const)("no range of an empty representation is satisfiable: %j", (range, size) => {
    expect(resolveRange(range, size)).toBe("unsatisfiable");
  });

  it("refuses a size that is not a Nat", () => {
    expect(() => resolveRange({ kind: "from", first: 0 }, -1)).toThrow(RangeError);
    expect(() => resolveRange({ kind: "from", first: 0 }, 1.5)).toThrow(RangeError);
  });

  it("ranges_inside: every resolved range lies inside the representation", () => {
    fc.assert(
      fc.property(spec, nat, (range, size) => {
        const resolved = resolveRange(range, size);
        return (
          resolved === "unsatisfiable" || (resolved.start < resolved.stop && resolved.stop <= size)
        );
      }),
    );
  });

  it("ranges_match_oracle: the module agrees with the RFC's arithmetic", () => {
    fc.assert(
      fc.property(spec, nat, (range, size) => {
        expect(resolveRange(range, size)).toEqual(oracle(range, size));
      }),
    );
  });
});

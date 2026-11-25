// Range requests (RFC 9110 §14). The oracle is a reference reader of the grammar of §14.1.1 and the
// rules of §14.1.2 written here: a `bytes` range-set of int-ranges and suffix-ranges, the unit
// compared case-insensitively. Davloom serves one byte range and no multipart responses: a server
// MAY ignore Range (§14.2), so several ranges and anything that is not a valid range-set give the
// whole representation, a satisfiable single range gives 206 with exactly its bytes, and an
// unsatisfiable one gives 416 with `bytes */length`. range.test.ts runs the table in process, and
// tests/integration/compat/http/range.test.ts over HTTP against real servers.

export const CONTENT = Array.from({ length: 100 }, (_, i) =>
  String.fromCharCode(48 + (i % 75)),
).join("");

type Spec =
  | { readonly kind: "int"; readonly first: bigint; readonly last: bigint | null }
  | { readonly kind: "suffix"; readonly length: bigint };

/** RFC 9110 §14.1.1 strictly: null when the field is not a valid bytes range-set. */
const parseStrict = (value: string): Spec[] | null => {
  const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=(.*)$/.exec(value);
  if (!match || match[1]?.toLowerCase() !== "bytes") return null;
  // §5.6.1: a list element may be empty and is then ignored; OWS surrounds the commas.
  const elements = (match[2] ?? "").split(/[ \t]*,[ \t]*/).filter((element) => element !== "");
  const specs: Spec[] = [];
  for (const element of elements) {
    const int = /^(\d+)-(\d*)$/.exec(element);
    const suffix = /^-(\d+)$/.exec(element);
    if (int) {
      const first = BigInt(int[1] ?? "");
      const last = int[2] === "" ? null : BigInt(int[2] ?? "");
      if (last !== null && last < first) return null;
      specs.push({ kind: "int", first, last });
    } else if (suffix) {
      specs.push({ kind: "suffix", length: BigInt(suffix[1] ?? "") });
    } else {
      return null;
    }
  }
  return specs.length > 0 ? specs : null;
};

/** §14.1.2: the bytes a spec selects in a representation of `size`, or null if unsatisfiable. */
const select = (spec: Spec, size: number): readonly [number, number] | null => {
  const length = BigInt(size);
  if (spec.kind === "int") {
    if (spec.first >= length) return null;
    const last = spec.last === null || spec.last >= length ? length - 1n : spec.last;
    return [Number(spec.first), Number(last)];
  }
  if (spec.length === 0n || length === 0n) return null;
  const start = spec.length >= length ? 0n : length - spec.length;
  return [Number(start), size - 1];
};

export type Outcome =
  | { readonly status: 200 }
  | { readonly status: 206; readonly first: number; readonly last: number }
  | { readonly status: 416 };

export const oracle = (value: string, size: number): Outcome => {
  const specs = parseStrict(value);
  if (specs?.length !== 1) return { status: 200 };
  const [spec] = specs;
  const selected = spec ? select(spec, size) : null;
  return selected ? { status: 206, first: selected[0], last: selected[1] } : { status: 416 };
};

/** The files of the world and their content. */
export const SIZES: Readonly<Record<string, string>> = {
  "/r.bin": CONTENT,
  "/one": "x",
  "/empty": "",
};

const FIRSTS = ["0", "1", "49", "98", "99", "100", "101", "1000"];
const LASTS = ["", "0", "1", "49", "98", "99", "100", "1000"];
const SUFFIXES = ["0", "1", "2", "50", "99", "100", "101", "10000"];

export const GRID: (readonly [string, string])[] = [
  ...FIRSTS.flatMap((first) => LASTS.map((last) => ["/r.bin", `bytes=${first}-${last}`] as const)),
  ...SUFFIXES.map((length) => ["/r.bin", `bytes=-${length}`] as const),
  ...["0-", "0-0", "0-1", "1-", "1-1", "2-", "-0", "-1", "-2"].map(
    (spec) => ["/one", `bytes=${spec}`] as const,
  ),
  ...["0-", "0-0", "5-10", "-1", "-0"].map((spec) => ["/empty", `bytes=${spec}`] as const),
];

export const FORMS: readonly string[] = [
  // Units: case-insensitive bytes, anything else ignored.
  "Bytes=0-9",
  "BYTES=10-19",
  "items=0-9",
  "bits=0-9",
  "none",
  "bytes0-9",
  // Not a range-set.
  "bytes=",
  "bytes=-",
  "bytes=a-b",
  "bytes=1-a",
  "bytes=--1",
  "bytes=-1-2",
  "bytes=0x0-1",
  "bytes=+1-2",
  "bytes=1.5-2",
  "bytes=1-2-3",
  "bytes 0-1",
  "bytes:0-1",
  "=0-1",
  "0-1",
  "bytes=\u00ad1",
  "bytes=1e2-",
  "@bytes=0-9",
  "x bytes=0-9",
  // Several ranges: ignored, satisfiable or not.
  "bytes=0-1,2-3",
  "bytes=0-1, 2-3",
  "bytes=-1,0-0",
  "bytes=0-0,0-0",
  "bytes=200-300,400-500",
  "bytes=0-1,a",
  "bytes=0-1,,5-6",
  // Huge numbers.
  "bytes=0-99999999999999999999999",
  "bytes=99999999999999999999999-",
  "bytes=-99999999999999999999999",
  "bytes=00000000000000000000000-00000000000000000000009",
];

/** Forms the grammar refuses but a lenient reader may honor; either answer is acceptable. */
export const LENIENT: readonly (readonly [value: string, strict: string])[] = [
  ["bytes = 0-9", "bytes=0-9"],
  ["bytes=0 - 9", "bytes=0-9"],
  ["bytes=\t0-9", "bytes=0-9"],
  ["bytes=0- 9", "bytes=0-9"],
  // Empty list elements are valid (§5.6.1) and leave one range, which a server may also ignore.
  ["bytes=0-9,", "bytes=0-9"],
  ["bytes=,0-9", "bytes=0-9"],
  ["bytes=0-9, ,", "bytes=0-9"],
];

/** Values a HEAD with Range answers like GET for, without a body. */
export const HEAD_RANGES: readonly string[] = [
  "bytes=0-9",
  "bytes=90-",
  "bytes=-0",
  "bytes=100-",
  "bytes=9-0",
  "bytes=0-1,3-4",
];

/** If-Range (RFC 9110 §13.1.5): the range applies only when the validator matches strongly. */
export const IF_RANGES: readonly (readonly [
  label: string,
  value: (etag: string, lastModified: string) => string,
  applies: boolean,
])[] = [
  ["the current strong tag", (etag) => etag, true],
  ["another strong tag", () => '"other"', false],
  ["the current tag made weak", (etag) => `W/${etag}`, false],
  ["two tags", (etag) => `${etag}, "other"`, false],
  ["a malformed tag", (etag) => etag.slice(1), false],
  [
    "a date before Last-Modified",
    (_, lastModified) => new Date(Date.parse(lastModified) - 1000).toUTCString(),
    false,
  ],
  [
    "a date after Last-Modified",
    (_, lastModified) => new Date(Date.parse(lastModified) + 1000).toUTCString(),
    false,
  ],
  ["a value that is no date", () => "yesterday", false],
];

import { isNat } from "./bend";
import bend, { type BendSpec } from "./compiled/ranges.mjs";

export type RangeSpec =
  | { readonly kind: "from-to"; readonly first: number; readonly last: number }
  | { readonly kind: "from"; readonly first: number }
  | { readonly kind: "suffix"; readonly length: number };

/** The bytes from `start` up to, not including, `stop`, or none. */
export type Resolved = { readonly start: number; readonly stop: number } | "unsatisfiable";

// Bend stops above 2^48 − 1, so larger client values are clamped first. No representation is that
// large, so a clamped value selects the same bytes: a first position past the size stays past it,
// and a last position or a suffix length past the size still reaches the end.
const clamp = (value: number): number => Math.min(value, 2 ** 48 - 2);

const toBend = (spec: RangeSpec): BendSpec =>
  spec.kind === "from-to"
    ? { $: "FromTo", first: clamp(spec.first), last: clamp(spec.last) }
    : spec.kind === "from"
      ? { $: "From", first: clamp(spec.first) }
      : { $: "Suffix", length: clamp(spec.length) };

/** Resolves one byte range against a representation of `size` bytes (RFC 9110 §14.1.2). */
export const resolveRange = (spec: RangeSpec, size: number): Resolved => {
  if (!isNat(size)) {
    throw new RangeError(`not a size: ${size}`);
  }
  // RFC 9110 §14.1.1: a range whose last position is below its first is invalid, and the law
  // range_inside holds for valid ranges only. parseRange never builds one.
  if (spec.kind === "from-to" && spec.last < spec.first) {
    throw new RangeError(`an inverted range: ${spec.first}-${spec.last}`);
  }
  const resolved = bend.resolve(toBend(spec), size);
  return resolved.$ === "Span" ? { start: resolved.start, stop: resolved.stop } : "unsatisfiable";
};

import type { RangeSpec } from "@davloom/laws";

export type Depth = "0" | "1" | "infinity";

/** Reads the Depth header; undefined when it is absent, null when it is malformed. */
export const parseDepth = (header: string | null): Depth | null | undefined => {
  if (header === null) return undefined;
  const value = header.trim().toLowerCase();
  return value === "0" || value === "1" || value === "infinity" ? value : null;
};

/** Reads the Overwrite header (RFC 4918 §10.6): T when absent, null when malformed. */
export const parseOverwrite = (header: string | null): boolean | null => {
  if (header === null) return true;
  const value = header.trim().toUpperCase();
  return value === "T" ? true : value === "F" ? false : null;
};

const DIGITS = /^\d+$/;

/**
 * Reads a Range header with one byte range. Any other form, including several ranges, gives null,
 * and the server then ignores the header and sends the whole representation (RFC 9110 §14.2).
 */
export const parseRange = (header: string | null): RangeSpec | null => {
  if (header === null) return null;
  const match = /^\s*bytes\s*=\s*([^,]*)$/i.exec(header);
  if (!match) return null;
  const spec = (match[1] ?? "").trim();
  const dash = spec.indexOf("-");
  if (dash === -1) return null;
  const first = spec.slice(0, dash).trim();
  const last = spec.slice(dash + 1).trim();
  if (first === "") {
    return DIGITS.test(last) ? { kind: "suffix", length: Number(last) } : null;
  }
  if (!DIGITS.test(first)) return null;
  if (last === "") return { kind: "from", first: Number(first) };
  if (!DIGITS.test(last) || Number(last) < Number(first)) return null;
  return { kind: "from-to", first: Number(first), last: Number(last) };
};

export interface EntityTag {
  readonly weak: boolean;
  readonly tag: string;
}

/** Reads If-Match or If-None-Match: `*`, a list of entity tags, or null when malformed. */
export const parseEntityTags = (header: string): "*" | EntityTag[] | null => {
  const value = header.trim();
  if (value === "*") return "*";
  const tags: EntityTag[] = [];
  const pattern = /\s*(W\/)?"([^"]*)"\s*(,|$)/gy;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while (consumed < value.length && (match = pattern.exec(value)) !== null) {
    tags.push({ weak: match[1] !== undefined, tag: match[2] ?? "" });
    consumed = pattern.lastIndex;
    if (match[3] === "") break;
  }
  return consumed === value.length && tags.length > 0 ? tags : null;
};

/** An HTTP date in milliseconds, or null. */
export const parseHttpDate = (header: string | null): number | null => {
  if (header === null) return null;
  const time = Date.parse(header);
  return Number.isNaN(time) ? null : time;
};

/** Truncates to whole seconds, the resolution of HTTP dates. */
export const toSeconds = (time: number) => Math.floor(time / 1000);

import { toList } from "./bend";
import bend from "./compiled/names.mjs";

/** The longest name in code points: a name takes at most 255 bytes, and each code point one or more. */
const MAX_NAME_CODE_POINTS = 255;
const MAX_PATH_NAMES = 450;

// Iterating a string yields code points, and a lone surrogate as itself.
const codePoints = (name: string): number[] => Array.from(name, (c) => c.codePointAt(0) ?? 0);

/** A name holds 1 to 255 bytes of UTF-8, no NUL, `/` or lone surrogate, and is not `.` or `..`. */
export const isValidName = (name: string): boolean =>
  name.length <= MAX_NAME_CODE_POINTS * 2 &&
  codePoints(name).length <= MAX_NAME_CODE_POINTS &&
  bend.name_ok(toList(codePoints(name)));

/** Every name is valid, and the names take at most 900 bytes with a `/` before each. */
export const isValidPath = (names: readonly string[]): boolean =>
  names.length <= MAX_PATH_NAMES &&
  names.every((name) => name.length <= MAX_NAME_CODE_POINTS * 2) &&
  bend.path_ok(toList(names.map((name) => toList(codePoints(name)))));

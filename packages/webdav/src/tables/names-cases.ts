// Unicode names and URL encoding (PRD §5). The oracle is the storage-namespace spec and RFC 3986: a
// name is stored exactly as given, so names that differ in any code point are different entries; a
// client reaches a name by percent-encoding its UTF-8 bytes; and the href a PROPFIND returns
// decodes back to the same name. names.test.ts runs the table in process, and
// tests/integration/compat/http/protocol-tables.test.ts over HTTP against real servers.

export const NAMES: readonly (readonly [label: string, name: string])[] = [
  ["a lower-case letter", "a"],
  ["an upper-case letter", "A"],
  ["a composed accent", "été"],
  ["a decomposed accent", "été"],
  ["CJK", "日本語のファイル"],
  ["Hangul", "한국어"],
  ["Arabic", "ملف"],
  ["Hebrew with a right-to-left mark", "קובץ‏"],
  ["Devanagari", "फ़ाइल"],
  ["an emoji", "photo 😀.jpg"],
  ["an emoji sequence", "👩‍👩‍👧‍👦"],
  ["a flag", "🇫🇷"],
  ["a space", "my file.txt"],
  ["a leading space", " lead"],
  ["a trailing space", "trail "],
  ["a tab", "a\tb"],
  ["a line feed", "a\nb"],
  ["a carriage return", "a\rb"],
  ["a control character", "a\u0001b"],
  ["DEL", "a\u007fb"],
  ["a literal escape", "100%20off"],
  ["a percent sign", "%"],
  ["encoded dots as text", "%2e%2e"],
  ["a number sign", "#tag"],
  ["a question mark", "why?"],
  ["a semicolon", "a;b"],
  ["an equals sign", "a=b"],
  ["an ampersand", "a&b"],
  ["angle brackets", "<tag>"],
  ["double quotes", '"quoted"'],
  ["an apostrophe", "it's"],
  ["a backslash", "back\\slash"],
  ["three dots", "..."],
  ["a dot, a space and a dot", ". ."],
  ["two leading dots", "..hidden"],
  ["two trailing dots", "name.."],
  ["a leading dot", ".profile"],
  ["a tilde", "~"],
  ["a plus sign", "a+b"],
  ["a comma", "a,b"],
  ["a colon", "c:drive"],
  ["an at sign", "@home"],
  ["square brackets", "[1]"],
  ["braces", "{x}"],
  ["a vertical bar", "a|b"],
  ["a caret and a backtick", "^`"],
  ["a no-break space", "a b"],
  ["a zero-width space", "a​b"],
  ["a byte order mark", "﻿bom"],
  ["a right-to-left override", "gpj.‮exe"],
  ["a ligature", "ﬁle"],
  ["the ohm sign", "Ω"],
  ["the Greek capital omega", "Ω"],
  ["sharp s", "straße"],
  ["dotted capital I", "İstanbul"],
  ["a leading combining mark", "́x"],
  ["fullwidth digits", "１２３"],
  ["a Roman numeral", "Ⅻ"],
  ["a Windows device name", "CON"],
  ["a name of 255 bytes", "n".repeat(255)],
  ["a name of 254 bytes in two-byte characters", "é".repeat(127)],
  ["a name of 252 bytes in four-byte characters", "😀".repeat(63)],
];

/** The path a client sends for a name: its UTF-8 bytes percent-encoded. */
export const url = (name: string) => `/${encodeURIComponent(name)}`;

/** The name an href of a PROPFIND answer decodes to. */
export const decodeHref = (href: string) =>
  decodeURIComponent(href.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));

/** Names that differ in any code point are different entries, whatever they look like. */
export const DISTINCT: readonly (readonly [string, string])[] = [
  ["a", "A"],
  ["é", "é"],
  ["Ω", "Ω"],
  ["a b", "a b"],
  ["file", "ﬁle"],
  ["x", "x​"],
];

/**
 * RFC 3986 §2.1: percent-encodings are case-insensitive, and unreserved characters may be sent
 * encoded or not; both URLs name one resource.
 */
export const SAME: readonly (readonly [string, string])[] = [
  ["%C3%A9", "%c3%a9"],
  ["%41", "A"],
  ["%7E", "~"],
  ["a%2Db", "a-b"],
  ["%5F", "_"],
];

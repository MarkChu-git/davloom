import { describe, expect, it } from "vitest";
import { BASE, hrefs, setup } from "../test/harness";

// Unicode names and URL encoding (PRD §5). The oracle is the storage-namespace spec and RFC 3986:
// a name is stored exactly as given, so names that differ in any code point are different
// entries; a client reaches a name by percent-encoding its UTF-8 bytes; and the href a PROPFIND
// returns decodes back to the same name.

const NAMES: readonly (readonly [label: string, name: string])[] = [
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

const url = (name: string) => `/${encodeURIComponent(name)}`;

const decodeHref = (href: string) =>
  decodeURIComponent(href.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));

describe("Unicode names", () => {
  it("has distinct names", () => {
    expect(new Set(NAMES.map(([, name]) => name)).size).toBe(NAMES.length);
  });

  it.each(NAMES)("a file named with %s round-trips through PUT and GET", async (_label, name) => {
    const w = setup();
    expect((await w.put(url(name), `content of ${name}`)).status).toBe(201);
    const response = await w.dav("GET", url(name));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`content of ${name}`);
    const stat = await w.storage.stat([name]);
    expect(stat.ok && stat.value.path).toEqual([name]);
  });

  it.each(NAMES)(
    "PROPFIND lists a collection named with %s by an href that decodes to it",
    async (_label, name) => {
      const w = setup();
      expect((await w.mkcol(url(name))).status).toBe(201);
      expect((await w.put(`${url(name)}/inner.txt`, "x")).status).toBe(201);
      const response = await w.dav("PROPFIND", "/", { headers: { depth: "1" } });
      const listed = hrefs(await response.text()).map((href = "") => href);
      const member = listed.filter((href) => href !== `${BASE}/`);
      expect(member).toHaveLength(1);
      expect(member[0]?.endsWith("/")).toBe(true);
      expect(decodeHref((member[0] ?? "").slice(BASE.length + 1, -1))).toBe(name);
    },
  );

  it.each(NAMES)(
    "a collection named with %s is deleted by its encoded URL",
    async (_label, name) => {
      const w = setup();
      await w.mkcol(url(name));
      await w.put(`${url(name)}/inner.txt`, "x");
      expect((await w.dav("DELETE", url(name))).status).toBe(204);
      expect((await w.storage.stat([name])).ok).toBe(false);
    },
  );

  // Names that differ in any code point are different entries, whatever they look like.
  it.each([
    ["a", "A"],
    ["é", "é"],
    ["Ω", "Ω"],
    ["a b", "a b"],
    ["file", "ﬁle"],
    ["x", "x​"],
  ])("%j and %j are two files", async (first, second) => {
    const w = setup();
    await w.put(url(first), "first");
    await w.put(url(second), "second");
    expect(await (await w.dav("GET", url(first))).text()).toBe("first");
    expect(await (await w.dav("GET", url(second))).text()).toBe("second");
  });

  // RFC 3986 §2.1: percent-encodings are case-insensitive, and unreserved characters may be
  // sent encoded or not; both URLs name one resource.
  it.each([
    ["%C3%A9", "%c3%a9"],
    ["%41", "A"],
    ["%7E", "~"],
    ["a%2Db", "a-b"],
    ["%5F", "_"],
  ])("%s and %s name the same file", async (sent, other) => {
    const w = setup();
    await w.put(`/${sent}`, "one");
    expect(await (await w.dav("GET", `/${other}`)).text()).toBe("one");
  });
});

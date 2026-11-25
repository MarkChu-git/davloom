import { createMemoryStorage } from "@davloom/core";
import { describe, expect, it } from "vitest";
import { BASE, hrefs, setup } from "../test/harness";
import { decodeHref, DISTINCT, NAMES, REFUSED, refusedByFileStore, SAME, url } from "./names-cases";
import { refusingBackend } from "./world";

// Unicode names and URL encoding (PRD §5): the table and oracle of names-cases.ts, against the
// handler.

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

  it.each(DISTINCT)("%j and %j are two files", async (first, second) => {
    const w = setup();
    await w.put(url(first), "first");
    await w.put(url(second), "second");
    expect(await (await w.dav("GET", url(first))).text()).toBe("first");
    expect(await (await w.dav("GET", url(second))).text()).toBe("second");
  });

  it.each(SAME)("%s and %s name the same file", async (sent, other) => {
    const w = setup();
    await w.put(`/${sent}`, "one");
    expect(await (await w.dav("GET", `/${other}`)).text()).toBe("one");
  });
});

// The self-hosted target's RustFS refuses some of these names (refusedByFileStore). Its oracle:
// what the store would create with a refused name answers REFUSED and changes nothing, and the
// name then answers as one that does not exist.
const refusing = () =>
  setup({ storage: refusingBackend(createMemoryStorage(), refusedByFileStore) });

/** The labels of the names a store like RustFS refuses for an entry of `kind`. */
const refusedLabels = (kind: "file" | "collection") =>
  NAMES.filter(([, name]) => refusedByFileStore([name], kind)).map(([label]) => label);

describe("Unicode names on a store that refuses names as RustFS does", () => {
  it("refuses the names RustFS 1.0.6 refused in CI, and no others", () => {
    const controls = ["a line feed", "a carriage return", "a control character"];
    expect(refusedLabels("file")).toEqual(controls);
    expect(refusedLabels("collection")).toEqual([
      ...controls,
      "a name of 255 bytes",
      "a name of 254 bytes in two-byte characters",
      "a name of 252 bytes in four-byte characters",
    ]);
  });

  it.each(NAMES)("a file named with %s round-trips or is refused", async (_label, name) => {
    const w = refusing();
    const put = await w.put(url(name), `content of ${name}`);
    const response = await w.dav("GET", url(name));
    if (refusedByFileStore([name], "file")) {
      expect(put.status).toBe(REFUSED);
      expect(await put.text()).toMatch(/Nothing was changed\. Choose another name\./);
      expect(response.status).toBe(404);
    } else {
      expect(put.status).toBe(201);
      expect(await response.text()).toBe(`content of ${name}`);
    }
  });

  it.each(NAMES)(
    "a collection named with %s is listed and deleted, or refused",
    async (_label, name) => {
      const w = refusing();
      const refused = refusedByFileStore([name], "collection");
      expect((await w.mkcol(url(name))).status).toBe(refused ? REFUSED : 201);
      expect((await w.put(`${url(name)}/inner.txt`, "x")).status).toBe(refused ? 409 : 201);
      const response = await w.dav("PROPFIND", "/", { headers: { depth: "1" } });
      const members = hrefs(await response.text()).filter((href) => href !== `${BASE}/`);
      expect(members).toHaveLength(refused ? 0 : 1);
      expect((await w.dav("DELETE", url(name))).status).toBe(refused ? 404 : 204);
      expect((await w.storage.stat([name])).ok).toBe(false);
    },
  );
});

// What the table holds, written out: the URL a client sends for each name (RFC 3986 §2.1, its
// UTF-8 bytes percent-encoded), with "refused" where a store like RustFS refuses it as a file or a
// collection. A change to a name or to the oracle that moves an answer fails here, not only in the
// comparison with the handler.
describe("the names table, written out", () => {
  it("encodes each name", () => {
    expect(
      NAMES.map(([label, name]) => {
        const refused = (["file", "collection"] as const).filter((kind) =>
          refusedByFileStore([name], kind),
        );
        const encoded = url(name);
        const shown = encoded.length > 60 ? `${encoded.slice(0, 19)}…(${encoded.length})` : encoded;
        return `${label}: ${shown}${refused.length > 0 ? ` refused as ${refused.join(", ")}` : ""}`;
      }),
    ).toMatchInlineSnapshot(`
      [
        "a lower-case letter: /a",
        "an upper-case letter: /A",
        "a composed accent: /%C3%A9t%C3%A9",
        "a decomposed accent: /e%CC%81te%CC%81",
        "CJK: /%E6%97%A5%E6%9C%AC…(73)",
        "Hangul: /%ED%95%9C%EA%B5%AD%EC%96%B4",
        "Arabic: /%D9%85%D9%84%D9%81",
        "Hebrew with a right-to-left mark: /%D7%A7%D7%95%D7%91%D7%A5%E2%80%8F",
        "Devanagari: /%E0%A4%AB%E0%A4%BC%E0%A4%BE%E0%A4%87%E0%A4%B2",
        "an emoji: /photo%20%F0%9F%98%80.jpg",
        "an emoji sequence: /%F0%9F%91%A9%E2%80…(76)",
        "a flag: /%F0%9F%87%AB%F0%9F%87%B7",
        "a space: /my%20file.txt",
        "a leading space: /%20lead",
        "a trailing space: /trail%20",
        "a tab: /a%09b",
        "a line feed: /a%0Ab refused as file, collection",
        "a carriage return: /a%0Db refused as file, collection",
        "a control character: /a%01b refused as file, collection",
        "DEL: /a%7Fb",
        "a literal escape: /100%2520off",
        "a percent sign: /%25",
        "encoded dots as text: /%252e%252e",
        "a number sign: /%23tag",
        "a question mark: /why%3F",
        "a semicolon: /a%3Bb",
        "an equals sign: /a%3Db",
        "an ampersand: /a%26b",
        "angle brackets: /%3Ctag%3E",
        "double quotes: /%22quoted%22",
        "an apostrophe: /it's",
        "a backslash: /back%5Cslash",
        "three dots: /...",
        "a dot, a space and a dot: /.%20.",
        "two leading dots: /..hidden",
        "two trailing dots: /name..",
        "a leading dot: /.profile",
        "a tilde: /~",
        "a plus sign: /a%2Bb",
        "a comma: /a%2Cb",
        "a colon: /c%3Adrive",
        "an at sign: /%40home",
        "square brackets: /%5B1%5D",
        "braces: /%7Bx%7D",
        "a vertical bar: /a%7Cb",
        "a caret and a backtick: /%5E%60",
        "a no-break space: /a%C2%A0b",
        "a zero-width space: /a%E2%80%8Bb",
        "a byte order mark: /%EF%BB%BFbom",
        "a right-to-left override: /gpj.%E2%80%AEexe",
        "a ligature: /%EF%AC%81le",
        "the ohm sign: /%E2%84%A6",
        "the Greek capital omega: /%CE%A9",
        "sharp s: /stra%C3%9Fe",
        "dotted capital I: /%C4%B0stanbul",
        "a leading combining mark: /%CC%81x",
        "fullwidth digits: /%EF%BC%91%EF%BC%92%EF%BC%93",
        "a Roman numeral: /%E2%85%AB",
        "a Windows device name: /CON",
        "a name of 255 bytes: /nnnnnnnnnnnnnnnnnn…(256) refused as collection",
        "a name of 254 bytes in two-byte characters: /%C3%A9%C3%A9%C3%A9…(763) refused as collection",
        "a name of 252 bytes in four-byte characters: /%F0%9F%98%80%F0%9F…(757) refused as collection",
      ]
    `);
  });

  it("pairs distinct names and equal URLs", () => {
    expect(DISTINCT.map(([a, b]) => `${url(a)} ${url(b)}`)).toMatchInlineSnapshot(`
      [
        "/a /A",
        "/%C3%A9 /e%CC%81",
        "/%E2%84%A6 /%CE%A9",
        "/a%20b /a%C2%A0b",
        "/file /%EF%AC%81le",
        "/x /x%E2%80%8B",
      ]
    `);
    expect(SAME.map(([a, b]) => `${a} ${b}`)).toMatchInlineSnapshot(`
      [
        "%C3%A9 %c3%a9",
        "%41 A",
        "%7E ~",
        "a%2Db a-b",
        "%5F _",
      ]
    `);
  });

  it("decodes an href with escaped markup", () => {
    expect(decodeHref("a%20b&lt;c&gt;&amp;d")).toBe("a b<c>&d");
    expect(decodeHref("%26lt%3B")).toBe("&lt;");
  });

  it("refuses names the way RustFS does", () => {
    const cases: readonly (readonly [string[], "file" | "collection", boolean])[] = [
      [["a\u001fb"], "file", true],
      [["a\u0000b"], "file", true],
      [["a\tb"], "file", false],
      [["a b"], "file", false],
      [["ok", "a\u0001"], "file", true],
      [["x\\..\\y"], "file", true],
      [["x\\.\\y"], "file", true],
      [[" .. "], "file", true],
      [["　.　"], "file", true],
      [["﻿.."], "file", false],
      [["..."], "file", false],
      [["x\\...\\y"], "file", false],
      [["n".repeat(246)], "collection", false],
      [["n".repeat(247)], "collection", true],
      [["n".repeat(247)], "file", false],
      [["n".repeat(247), "short"], "collection", false],
      [["short", "n".repeat(247)], "collection", true],
      [[], "collection", false],
    ];
    expect(cases.map(([names, kind]) => refusedByFileStore(names, kind))).toEqual(
      cases.map(([, , refused]) => refused),
    );
    expect(REFUSED).toBe(403);
  });
});

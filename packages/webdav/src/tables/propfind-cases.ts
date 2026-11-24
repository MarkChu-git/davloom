// PROPFIND responses: every live property of RFC 4918 §15 and RFC 4331 × four kinds of resource ×
// four request forms (prop, propname, allprop, allprop with include). The oracle is the definitions
// of those sections, written as rules here: whether each property must be defined on a kind of
// resource, must not be, or may be, what its value looks like, and which belong to allprop. A
// server that supports locking defines lockdiscovery and supportedlock (§15.8, §15.10); a file's
// getcontentlength, getcontenttype, getetag and getlastmodified match what GET returns
// (§15.4–15.7). propfind.test.ts runs the table in process, and
// tests/integration/compat/http/protocol-tables.test.ts over HTTP against real servers.

export type Kind = "file" | "collection" | "root" | "mount root";
type Rule = "required" | "absent" | "optional";
export type Form = "prop" | "propname" | "allprop" | "include";

export const PATHS: Readonly<Record<Kind, string>> = {
  file: "/files/photos/a.jpg",
  collection: "/files/photos",
  root: "/",
  "mount root": "/files",
};

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const ENTITY_TAG = /^(W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/;
const MEDIA_TYPE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(\s*;.*)?$/;

export interface Get {
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly length: string | null;
  readonly type: string | null;
}

interface Property {
  readonly rules: Readonly<Record<Kind, Rule>>;
  /** Whether allprop returns it (RFC 4918 §9.1; RFC 4331 leaves quota out). */
  readonly allprop: boolean;
  readonly valid: (value: string, kind: Kind, get: Get) => boolean;
}

const all = (rule: Rule) => ({ file: rule, collection: rule, root: rule, "mount root": rule });
const fileOnly = {
  file: "required",
  collection: "optional",
  root: "optional",
  "mount root": "optional",
} as const;
const unescape = (text: string) =>
  text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

export const PROPERTIES: Readonly<Record<string, Property>> = {
  // §15.1: SHOULD be defined on all resources; the virtual root may have no creation time.
  creationdate: {
    rules: { file: "required", collection: "required", root: "optional", "mount root": "required" },
    allprop: true,
    valid: (value) => RFC3339.test(value),
  },
  displayname: { rules: all("optional"), allprop: true, valid: () => true },
  // §15.3: defined only with a Content-Language, which Davloom never stores.
  getcontentlanguage: { rules: all("absent"), allprop: true, valid: () => true },
  getcontentlength: {
    rules: fileOnly,
    allprop: true,
    valid: (value, kind, get) => (kind === "file" ? value === get.length : /^\d+$/.test(value)),
  },
  getcontenttype: {
    rules: fileOnly,
    allprop: true,
    valid: (value, kind, get) =>
      kind === "file" ? unescape(value) === get.type : MEDIA_TYPE.test(unescape(value)),
  },
  getetag: {
    rules: fileOnly,
    allprop: true,
    valid: (value, kind, get) => (kind === "file" ? value === get.etag : ENTITY_TAG.test(value)),
  },
  getlastmodified: {
    rules: fileOnly,
    allprop: true,
    valid: (value, kind, get) =>
      kind === "file" ? value === get.lastModified : IMF_FIXDATE.test(value),
  },
  // §15.8: no locks are held, so the property is empty.
  lockdiscovery: { rules: all("required"), allprop: true, valid: (value) => value === "" },
  // §15.9: a collection's resourcetype holds DAV:collection, a file's is empty.
  resourcetype: {
    rules: all("required"),
    allprop: true,
    valid: (value, kind) => (kind === "file" ? value === "" : value === "<D:collection/>"),
  },
  // §15.10: lists the write locks the resource supports.
  supportedlock: {
    rules: all("required"),
    allprop: true,
    valid: (value) =>
      value.includes("<D:lockentry>") &&
      value.includes("<D:write/>") &&
      value.includes("<D:exclusive/>"),
  },
  // RFC 4331 §3, §4: optional, not in allprop, a count of bytes when present.
  "quota-available-bytes": {
    rules: all("optional"),
    allprop: false,
    valid: (value) => /^\d+$/.test(value),
  },
  "quota-used-bytes": {
    rules: all("optional"),
    allprop: false,
    valid: (value) => /^\d+$/.test(value),
  },
};

export const BODIES: Readonly<Record<Form, (name: string) => string>> = {
  prop: (name) => `<D:prop><D:${name}/></D:prop>`,
  propname: () => "<D:propname/>",
  allprop: () => "<D:allprop/>",
  include: (name) => `<D:allprop/><D:include><D:${name}/></D:include>`,
};

interface Found {
  readonly status: number;
  /** The element's content; "" for an empty element. */
  readonly value: string;
}

/** Finds a DAV: property in the one response of a multistatus body. */
export const findProperty = (xml: string, name: string): Found[] => {
  const found: Found[] = [];
  for (const [, inner = "", status = ""] of xml.matchAll(
    /<D:propstat><D:prop>(.*?)<\/D:prop><D:status>HTTP\/1\.1 (\d{3})[^<]*<\/D:status><\/D:propstat>/gs,
  )) {
    const element = new RegExp(`<D:${name}(?:/>|>(.*?)</D:${name}>)`, "s").exec(inner);
    if (element) found.push({ status: Number(status), value: element[1] ?? "" });
  }
  return found;
};

/** A PROPFIND body around the inner elements of one of BODIES. */
export const propfindOf = (inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:">${inner}</D:propfind>`;

export const FORMS: readonly Form[] = ["prop", "propname", "allprop", "include"];
export const KINDS: readonly Kind[] = ["file", "collection", "root", "mount root"];
export const TABLE = Object.keys(PROPERTIES).flatMap((name) =>
  KINDS.flatMap((kind) => FORMS.map((form) => [name, kind, form] as const)),
);

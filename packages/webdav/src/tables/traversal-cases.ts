import { REFUSED, type Refuses } from "./names-cases";
import { BASE, FILES, under } from "./world";

// Path traversal and encoding (PRD §11, §12): 80 payloads at each entry point that takes a path,
// for a Read / Write key limited to /files/photos. Each payload follows /dav/files/photos/ in a
// URL. The oracle resolves it the way the standards do, independently of the handler: the WHATWG
// URL parser that every client and runtime shares removes dot segments (including %2e forms and
// backslashes in an https URL), then each segment is percent-decoded as UTF-8, and the names are
// checked against the namespace's rules (storage-namespace spec: 1 to 255 bytes of well-formed
// UTF-8, not `.` or `..`, no `/` or NUL, a path of at most 900 bytes with a `/` before each name).
// Whatever a payload resolves to, nothing outside the scope may be read or change.
// traversal.test.ts runs the table in process, and tests/integration/compat/http/traversal.test.ts
// over HTTP against real servers.

export const SCOPE = ["files", "photos"];
export const SCOPE_KEY = SCOPE.join("/");
/** The URL each payload follows, on a server at `origin` whose WebDAV base path is /dav. */
export const prefixOf = (origin: string) => `${origin}${BASE}/${SCOPE_KEY}/`;

export const PAYLOADS: readonly (readonly [label: string, payload: string])[] = [
  ["parent segment", ".."],
  ["parent then sibling file", "../docs/secret.txt"],
  ["encoded dots", "%2e%2e/docs/secret.txt"],
  ["encoded dots, upper case", "%2E%2E/docs/secret.txt"],
  ["encoded dots, mixed case", "%2E%2e/docs/secret.txt"],
  ["one dot encoded, first", "%2e./docs/secret.txt"],
  ["one dot encoded, second", ".%2E/docs/secret.txt"],
  ["two parents to the namespace root", "../../media/music/c.mp3"],
  ["parents past the base path", "../../../etc/passwd"],
  ["parents far past the URL root", "../../../../../../../../etc/passwd"],
  ["parents back into the base path", "../../../dav/files/docs/secret.txt"],
  ["parent into a name-prefix neighbour", "../photos2/z.txt"],
  ["parent and back into the scope", "../photos/a.jpg"],
  ["double-encoded dots", "%252e%252e/docs/secret.txt"],
  ["double-encoded dots and slashes", "%252e%252e%252fdocs%252fsecret.txt"],
  ["double-encoded with percent split", "%%32%65%%32%65/docs/secret.txt"],
  ["encoded slash in a name", "..%2fdocs%2fsecret.txt"],
  ["encoded slash, upper case", "..%2Fdocs%2Fsecret.txt"],
  ["fully encoded parent and slash", "%2e%2e%2fdocs%2fsecret.txt"],
  ["encoded slashes to /etc", "..%2f..%2f..%2fetc%2fpasswd"],
  ["double-encoded slash", "..%252f..%252fdocs"],
  ["backslashes", "..\\docs\\secret.txt"],
  ["backslash before the parent", "\\..\\docs\\secret.txt"],
  ["encoded backslashes", "..%5cdocs%5csecret.txt"],
  ["encoded backslash, upper case", "%5C..%5Cdocs"],
  ["encoded dots and backslashes", "%2e%2e%5c%2e%2e%5c"],
  ["NUL alone", "%00"],
  ["NUL after a name", "a.jpg%00"],
  ["NUL inside a name", "a.jpg%00.txt"],
  ["NUL after the parent", "..%00/docs/secret.txt"],
  ["NUL between dots", ".%00."],
  ["overlong two-byte dots", "%c0%ae%c0%ae/docs/secret.txt"],
  ["overlong two-byte slash", "..%c0%afdocs"],
  ["overlong three-byte dots", "%e0%80%ae%e0%80%ae/docs"],
  ["overlong backslash", "..%c1%9cdocs"],
  ["overlong NUL", "a%C0%80b"],
  ["UTF-8 surrogate", "%ed%a0%80"],
  ["invalid UTF-8 byte", "%ff"],
  ["lone percent", "%"],
  ["percent with no hex", "%zz"],
  ["truncated escape", "%2"],
  ["IIS %u escape of dots", "%u002e%u002e/docs"],
  ["IIS %u escape of a slash", "..%u2215docs"],
  ["current segment", "./a.jpg"],
  ["encoded current segment", "%2e/a.jpg"],
  ["current segment alone", "."],
  ["encoded current segment alone", "%2e"],
  ["three dots", "..."],
  ["four dots with doubled slashes", "....//....//docs"],
  ["trailing dot", "a.jpg."],
  ["two trailing dots", "a.jpg.."],
  ["trailing space", "a.jpg%20"],
  ["parent with a trailing space", "..%20/docs/secret.txt"],
  ["parent with a leading space", "%20../docs"],
  ["Tomcat path parameter", "..;/docs/secret.txt"],
  ["path parameter before the parent", ";/../docs/secret.txt"],
  ["encoded semicolon", "..%3b/docs"],
  ["fullwidth full stops", "%EF%BC%8E%EF%BC%8E/docs/secret.txt"],
  ["one dot leaders", "%E2%80%A4%E2%80%A4/docs"],
  ["division slash", "..%E2%88%95docs"],
  ["fullwidth solidus", "..%EF%BC%8Fdocs"],
  ["fraction slash", "..%E2%81%84docs"],
  ["byte order mark before the parent", "%EF%BB%BF.."],
  ["zero-width space after the parent", "..%E2%80%8B"],
  ["right-to-left override", "%E2%80%AEgpj.a"],
  ["decomposed accent", "e%CC%81.txt"],
  ["line separator", "a%E2%80%A8b"],
  ["CR LF in a name", "a%0d%0ab"],
  ["tab and DEL", "a%09%7fb"],
  ["encoded question mark", "a%3fb"],
  ["encoded number sign", "a%23b"],
  ["query that names a parent", "?x=../../docs/secret.txt"],
  ["fragment that names a parent", "#../../docs/secret.txt"],
  ["query after a name", "a.jpg?/../../docs/secret.txt"],
  ["Windows device name", "CON"],
  ["NTFS alternate stream", "a.jpg::$DATA"],
  ["tilde short name", "PHOTOS~1"],
  ["empty segments", "//sub//b.jpg"],
  ["empty segments around a parent", "/../docs/secret.txt"],
  ["the scope root again", "photos"],
  ["a name of 255 bytes", "a".repeat(255)],
  ["a name of 256 bytes", "a".repeat(256)],
  ["a name of 254 bytes in two-byte characters", "%C3%A9".repeat(127)],
  ["a name of 256 bytes in two-byte characters", "%C3%A9".repeat(128)],
  ["a path of exactly 900 bytes", `${"abcd/".repeat(177)}a`],
  ["a path of 901 bytes", `${"abcd/".repeat(177)}ab`],
  ["a path of more than 900 bytes", "abcd/".repeat(200)],
  ["a path of more than 450 names", "a/".repeat(460)],
  ["a deep path under a missing folder", "x/".repeat(30)],
];

// --- The oracle ---------------------------------------------------------------------------------

export type Resolved =
  | { readonly kind: "invalid" }
  | { readonly kind: "foreign" }
  | { readonly kind: "path"; readonly names: readonly string[] };

const bytes = (text: string) => new TextEncoder().encode(text).length;

const validName = (name: string) =>
  name !== "." &&
  name !== ".." &&
  bytes(name) >= 1 &&
  bytes(name) <= 255 &&
  !name.includes("/") &&
  !name.includes("\0");

export const resolve = (url: string): Resolved => {
  const { pathname } = new URL(url);
  if (pathname !== BASE && !pathname.startsWith(`${BASE}/`)) return { kind: "foreign" };
  const names: string[] = [];
  for (const segment of pathname.slice(BASE.length).split("/")) {
    if (segment === "") continue;
    try {
      names.push(decodeURIComponent(segment));
    } catch {
      return { kind: "invalid" };
    }
  }
  // The 900 bytes count a `/` before each name, as the law path_bounded does.
  if (!names.every(validName) || bytes(`/${names.join("/")}`) > 900) return { kind: "invalid" };
  return { kind: "path", names };
};

const startsWith = (path: readonly string[], prefix: readonly string[]) =>
  path.length >= prefix.length && prefix.every((name, i) => path[i] === name);

const relationOf = (names: readonly string[]) =>
  startsWith(names, SCOPE) ? "inside" : startsWith(SCOPE, names) ? "above" : "outside";

const kindOf = (names: readonly string[]): "file" | "collection" | "missing" => {
  const key = names.join("/");
  if (Object.hasOwn(FILES, key)) return "file";
  if (names.length <= 1 || key === SCOPE_KEY || key === `${SCOPE_KEY}/sub`) return "collection";
  if (["files/docs", "files/photos2", "media/music"].includes(key)) return "collection";
  return "missing";
};

export const ENTRIES = ["GET", "PUT", "MKCOL", "DELETE", "PROPFIND", "COPY", "MOVE", "If"] as const;
export type Entry = (typeof ENTRIES)[number];

const SOURCE = ["files", "photos", "a.jpg"];

/**
 * The statuses RFC 4918 and the policy allow for the payload at the entry point, on a store that
 * refuses the names `refuses` holds for, or on one that keeps every valid name. Where the answer
 * would create the entry, a store that refuses its name makes it REFUSED (names-cases.ts).
 */
export const expected = (entry: Entry, resolved: Resolved, refuses?: Refuses): number[] => {
  const statuses = expectedOnAnyStore(entry, resolved);
  if (!refuses || resolved.kind !== "path" || !statuses.includes(201)) return statuses;
  const kind = entry === "MKCOL" ? "collection" : "file";
  return refuses(resolved.names, kind) ? [...statuses, REFUSED] : statuses;
};

const expectedOnAnyStore = (entry: Entry, resolved: Resolved): number[] => {
  if (entry === "If") {
    // A tagged list is true only for a resource the key may read; `Not` of an unknown tag holds.
    return resolved.kind === "path" && relationOf(resolved.names) === "inside" ? [204] : [412];
  }
  const header = entry === "COPY" || entry === "MOVE";
  if (resolved.kind === "invalid") return [400];
  // A Destination outside the WebDAV namespace is a resource this server does not serve.
  if (resolved.kind === "foreign") return header ? [502, 403] : [404];
  const { names } = resolved;
  const where = relationOf(names);
  if (where === "outside") return [403];
  if (where === "above") return entry === "PROPFIND" ? [207] : [403];
  const kind = kindOf(names);
  const parent = kindOf(names.slice(0, -1));
  switch (entry) {
    case "GET":
      return kind === "file" ? [200] : kind === "collection" ? [405] : [404];
    case "PUT":
      if (kind === "collection") return [405];
      if (kind === "file") return [204];
      return parent === "collection" ? [201] : [409];
    case "MKCOL":
      if (kind !== "missing") return [405];
      return parent === "collection" ? [201] : [409];
    case "DELETE":
      return kind === "missing" ? [404] : [204];
    case "PROPFIND":
      return kind === "missing" ? [404] : [207];
    default: {
      // RFC 4918 §9.8.5: 403 onto the source itself; overwriting an ancestor would destroy the
      // source first, so it is refused the same way.
      if (startsWith(SOURCE, names)) return [403];
      // Below the source is inside it (403), and its parent is a file (409).
      if (startsWith(names, SOURCE)) return [403, 409];
      if (kind !== "missing") return [204];
      return parent === "collection" ? [201] : [409];
    }
  }
};

// --- The requests ----------------------------------------------------------------------------------

export const requestOf = (
  entry: Entry,
  payload: string,
  origin: string,
): { method: string; url: string; init: RequestInit } => {
  const prefix = prefixOf(origin);
  const url = `${prefix}${payload}`;
  switch (entry) {
    case "GET":
    case "MKCOL":
    case "DELETE":
      return { method: entry, url, init: {} };
    case "PUT":
      return { method: entry, url, init: { body: "planted" } };
    case "PROPFIND":
      return { method: entry, url, init: { headers: { depth: "0" } } };
    case "COPY":
    case "MOVE":
      return { method: entry, url: `${prefix}a.jpg`, init: { headers: { destination: url } } };
    default:
      // A tagged list of the If header.
      return {
        method: "PUT",
        url: `${prefix}a.jpg`,
        init: { body: "planted", headers: { if: `<${url}> (Not ["no-such-tag"])` } },
      };
  }
};

/** The content of every file outside the scope, which no answer may contain. */
export const OUTSIDE_CONTENT = Object.entries(FILES)
  .filter(([path]) => !under(path, SCOPE_KEY))
  .map(([, content]) => content);

/** The entries of a snapshot outside the scope. */
export const outside = (snap: Record<string, string>) =>
  Object.entries(snap).filter(([key]) => !under(key, SCOPE_KEY));

export const TABLE = ENTRIES.flatMap((entry) =>
  PAYLOADS.map(([label, payload]) => [entry, label, payload] as const),
);

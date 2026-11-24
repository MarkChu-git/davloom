// Depth, Overwrite, Timeout and Destination (RFC 4918 §10.2, §10.6, §10.7, §10.3). The grammars are
// written here: Depth = "0" / "1" / "infinity", Overwrite = "T" / "F", both compared
// case-insensitively as ABNF strings are (RFC 5234 §2.3); TimeType = "Second-" 1*DIGIT /
// "Infinite"; Destination = a URI reference resolved against the request URL. Each method accepts
// the Depth values RFC 4918 gives it, and the namespace answers as the model below predicts.
// request-headers.test.ts runs the table in process, and
// tests/integration/compat/http/protocol-tables.test.ts over HTTP against real servers.

export const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';

export type DepthValue = "0" | "1" | "infinity" | null;

/** RFC 4918 §10.2: null when the field is absent, "bad" when it is not one of the three values. */
export const readDepth = (value: string | undefined): DepthValue | "bad" => {
  if (value === undefined) return null;
  const v = value.trim().toLowerCase();
  return v === "0" || v === "1" || v === "infinity" ? v : "bad";
};

export const DEPTHS: readonly (string | undefined)[] = [
  undefined,
  "0",
  "1",
  "infinity",
  "Infinity",
  "INFINITY",
  " 1 ",
  "2",
  "-1",
  "01",
  "1.0",
  "one",
  "0, 1",
  "",
  "infinite",
];

export const OVERWRITES: readonly (string | undefined)[] = [
  undefined,
  "T",
  "F",
  "t",
  "f",
  " F ",
  "X",
  "TRUE",
  "false",
  "",
  "T, F",
  "0",
];

/** RFC 4918 §10.6: true by default, "bad" when not T or F. */
export const readOverwrite = (value: string | undefined): boolean | "bad" => {
  if (value === undefined) return true;
  const v = value.trim().toUpperCase();
  return v === "T" ? true : v === "F" ? false : "bad";
};

export const TIMEOUTS: readonly (readonly [value: string | undefined, requested: number | null])[] =
  [
    [undefined, null],
    ["Second-60", 60],
    ["Second-1", 1],
    ["second-60", 60],
    ["SECOND-120", 120],
    ["Second-3600", 3600],
    ["Second-3601", 3601],
    ["Second-4100000000", 4100000000],
    ["Infinite", null],
    ["infinite", null],
    ["Infinite, Second-60", null],
    ["Second-60, Infinite", 60],
    ["Second-0", 0],
    // Not a TimeType: the server chooses.
    ["Second--5", null],
    ["Second-abc", null],
    ["Minutes-5", null],
    ["", null],
    ["Second- 60", null],
    ["60", null],
  ];

export interface Where {
  /** The origin a request goes to, like https://dav.example. */
  readonly origin: string;
  /** The path of the WebDAV namespace, like /dav. */
  readonly namespace: string;
  /** The path of the folder the world is built in: the namespace itself, or a folder in it. */
  readonly root: string;
}

/**
 * Destinations of a COPY or MOVE of `${root}/f.txt`, the statuses each allows, and the name it
 * creates in the world's folder.
 */
export const destinationsOf = ({
  origin,
  namespace,
  root,
}: Where): readonly (readonly [
  label: string,
  value: string | undefined,
  statuses: number[],
  created: string | null,
])[] => {
  const { protocol, host, hostname, port } = new URL(origin);
  const otherPort = port === "8443" ? "8444" : "8443";
  const otherScheme = protocol === "https:" ? "http:" : "https:";
  const at = `${origin}${root}`;
  return [
    ["an absolute URL", `${at}/new.txt`, [201], "new.txt"],
    ["an absolute path", `${root}/new.txt`, [201], "new.txt"],
    ["a relative reference", "new.txt", [201], "new.txt"],
    ["a network-path reference", `//${host}${root}/new.txt`, [201], "new.txt"],
    ["an upper-case host", `${protocol}//${host.toUpperCase()}${root}/new.txt`, [201], "new.txt"],
    ["dot segments", `${at}/c/../new.txt`, [201], "new.txt"],
    ["a query", `${at}/new.txt?x=1`, [201], "new.txt"],
    ["a fragment", `${at}/new.txt#top`, [201], "new.txt"],
    ["an encoded space", `${at}/new%20name.txt`, [201], "new name.txt"],
    ["encoded UTF-8", `${at}/%C3%A9t%C3%A9.txt`, [201], "été.txt"],
    ["a collection to replace", `${at}/c/`, [204], "c"],
    ["a file to replace", `${at}/g.txt`, [204], "g.txt"],
    // §9.8.5: another server is 502; outside the namespace is not this server's to write.
    ["another host", `${protocol}//other.example${root}/new.txt`, [502], null],
    ["another port", `${protocol}//${hostname}:${otherPort}${root}/new.txt`, [502], null],
    ["another host by network path", `//other.example${root}/new.txt`, [502], null],
    ["another scheme", `${otherScheme}//${host}${root}/new.txt`, [201, 502], null],
    ["a path outside the namespace", `${origin}/other/new.txt`, [502, 403], null],
    [
      "a path that only starts like the namespace",
      `${origin}${namespace}x/new.txt`,
      [502, 403],
      null,
    ],
    ["the source itself", `${at}/f.txt`, [403], null],
    ["the namespace root", `${origin}${namespace}/`, [403], null],
    // Below the source is inside it (403), and its parent is a file (409): either refuses it.
    ["below the source file", `${at}/f.txt/new.txt`, [403, 409], null],
    ["a missing parent", `${at}/missing/new.txt`, [409], null],
    ["an invalid escape", `${at}/%zz`, [400], null],
    ["an encoded NUL", `${at}/a%00b`, [400], null],
    ["an encoded slash in a name", `${at}/a%2Fb`, [400], null],
    ["an unparsable URL", "http://[", [400], null],
    ["a URN", "urn:example:x", [400, 502], null],
    ["no Destination", undefined, [400], null],
  ];
};

/** The world: /c holds x.txt and d/y.txt; /f.txt and /g.txt are files. */
export const WORLD: Readonly<Record<string, string>> = {
  "/c/": "",
  "/c/x.txt": "x",
  "/c/d/": "",
  "/c/d/y.txt": "y",
  "/f.txt": "f-content",
  "/g.txt": "g-content",
};

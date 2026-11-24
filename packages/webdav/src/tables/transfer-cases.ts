// COPY and MOVE (RFC 4918 §9.8, §9.9) of a file, an empty collection and a collection with members,
// onto each kind of destination, with Overwrite T and F. The oracle is the RFC's status list: 201
// when the destination is new, 204 when it replaced a resource (which Overwrite T first deletes,
// §9.8.4), 412 when it exists and Overwrite is F, 409 without a parent collection, and 403 when the
// source and destination are the same or one contains the other. After a success the destination
// holds exactly the source's tree; after a failure nothing has changed. transfer.test.ts runs the
// table in process, and tests/integration/compat/http/protocol-tables.test.ts over HTTP against
// real servers.

export type Source = "a file" | "an empty collection" | "a collection with members";
export const SOURCES: Readonly<Record<Source, string>> = {
  "a file": "/p/s.txt",
  "an empty collection": "/p/e",
  "a collection with members": "/p/m",
};

const SOURCE_KINDS: readonly Source[] = [
  "a file",
  "an empty collection",
  "a collection with members",
];

export type Destination =
  | "a new name"
  | "an existing file"
  | "an existing collection"
  | "a name with no parent"
  | "a name under a file"
  | "a name inside the source"
  | "the source itself"
  | "the source's parent";

const DESTINATIONS: readonly Destination[] = [
  "a new name",
  "an existing file",
  "an existing collection",
  "a name with no parent",
  "a name under a file",
  "a name inside the source",
  "the source itself",
  "the source's parent",
];

export const destinationPath = (destination: Destination, source: string) =>
  ({
    "a new name": "/new",
    "an existing file": "/df.txt",
    "an existing collection": "/dc",
    "a name with no parent": "/nope/new",
    "a name under a file": "/df.txt/new",
    "a name inside the source": `${source}/inner`,
    "the source itself": source,
    "the source's parent": "/p",
  })[destination];

export const statusesOf = (
  source: Source,
  destination: Destination,
  overwrite: boolean,
): number[] => {
  switch (destination) {
    case "a new name":
      return [201];
    case "an existing file":
    case "an existing collection":
      return overwrite ? [204] : [412];
    case "a name with no parent":
    case "a name under a file":
      return [409];
    case "a name inside the source":
      // Inside a file is under a file (409); inside a collection is into itself (403).
      return source === "a file" ? [403, 409] : [403];
    case "the source itself":
      return [403];
    default:
      // The source's parent. Replacing the parent would delete the source; with Overwrite F it simply exists.
      return overwrite ? [403] : [403, 412];
  }
};

/** The entries of a snapshot under a path, with the path made relative. */
export const subtree = (snap: Record<string, string>, path: string) =>
  Object.fromEntries(
    Object.entries(snap)
      .filter(([key]) => key === path || key === `${path}/` || key.startsWith(`${path}/`))
      .map(([key, value]) => [key.slice(path.length), value.replace(/ \[.*\]$/, "")]),
  );

export const TABLE = (["COPY", "MOVE"] as const).flatMap((method) =>
  SOURCE_KINDS.flatMap((source) =>
    DESTINATIONS.flatMap((destination) =>
      [true, false].map((overwrite) => [method, source, destination, overwrite] as const),
    ),
  ),
);

/** The entries of a snapshot under neither the source nor the destination. */
export const rest = (snap: Record<string, string>, from: string, to: string) =>
  Object.fromEntries(
    Object.entries(snap).filter(
      ([key]) => ![from, to].some((p) => key === p || key === `${p}/` || key.startsWith(`${p}/`)),
    ),
  );

/** The world: /p holds the sources, /df.txt and /dc are destinations that exist. */
export const WORLD: Readonly<Record<string, string>> = {
  "/p/": "",
  "/p/s.txt": "source-file",
  "/p/e/": "",
  "/p/m/": "",
  "/p/m/x.txt": "x-content",
  "/p/m/sub/": "",
  "/p/m/sub/y.txt": "y-content",
  "/df.txt": "old-file",
  "/dc/": "",
  "/dc/z.txt": "old-member",
};

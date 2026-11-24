import { decideMigration, type CopyTarget } from "@davloom/laws";
import {
  childElements,
  DAV,
  findChild,
  parseXml,
  serializeElement,
  textOf,
  type XmlElement,
} from "@davloom/webdav/xml";

// Copies a tree of files from one WebDAV collection to another, such as a Mount of a Davloom on
// Workers to a Mount of a self-hosted one (PRD §7 Data Migration). It speaks plain WebDAV with an
// API Key each side, so it moves files between any two backends: Durable Objects, R2 and
// S3-compatible storage. Each entry's action comes from the proven decision `decideMigration`: it never
// writes over a collection or over a different file unless asked to, and a run that stopped can
// run again and copy only what is missing. Every file written is read back and its SHA-256 checked
// against the source's, and dead properties go along with their resources.

export interface Endpoint {
  /** The URL of the collection to copy from or to, such as https://host/dav/files/. */
  readonly url: string;
  /** An API Key: Read Only for the source, Read/Write for the target. */
  readonly key: string;
  readonly fetch?: (request: Request) => Promise<Response>;
}

export interface MigrateOptions {
  readonly source: Endpoint;
  readonly target: Endpoint;
  /** Replace a file of the target that differs from the source's. */
  readonly overwrite?: boolean;
  /** Called once per entry, after its action. */
  readonly onEntry?: (event: { path: string; action: string }) => void;
}

export interface MigrateReport {
  created: number;
  written: number;
  skipped: number;
  bytes: number;
  properties: number;
  /** The paths where the target holds something else, which a run leaves alone. */
  conflicts: string[];
}

export class MigrationError extends Error {
  override readonly name = "MigrationError";
}

interface Entry {
  readonly path: readonly string[];
  readonly kind: "file" | "folder";
  readonly size: number;
  /** The entity tag, as the server sent it, quotes included; empty when it sent none. */
  readonly etag: string;
  /** Dead properties: every property outside the DAV: namespace. */
  readonly properties: readonly XmlElement[];
}

/** PROPFIND answers of large collections are larger than a request body may be. */
const RESPONSE_LIMITS = { bytes: 256 * 1024 * 1024, depth: 64, elements: 5_000_000 };

const ALLPROP =
  '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';

const withSlash = (url: string) => (url.endsWith("/") ? url : `${url}/`);

const urlOf = (endpoint: Endpoint, path: readonly string[], folder = false) =>
  new URL(
    path.map(encodeURIComponent).join("/") + (folder && path.length > 0 ? "/" : ""),
    withSlash(endpoint.url),
  ).toString();

const send = async (
  endpoint: Endpoint,
  method: string,
  path: readonly string[],
  init: { headers?: Record<string, string>; body?: BodyInit | null; folder?: boolean } = {},
): Promise<Response> => {
  const request = new Request(urlOf(endpoint, path, init.folder), {
    method,
    headers: { authorization: `Basic ${btoa(`davloom:${endpoint.key}`)}`, ...init.headers },
    body: init.body ?? null,
    // A streamed body must say so.
    ...(init.body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
  return await (endpoint.fetch ?? fetch)(request);
};

const fail = async (response: Response, method: string, path: readonly string[]) => {
  await response.body?.cancel();
  return new MigrationError(`${method} /${path.join("/")} answered ${response.status}`);
};

/** The decoded names of a URL path. Servers and people encode the same name differently. */
const namesOf = (pathname: string): string[] | null => {
  try {
    return pathname
      .split("/")
      .filter((name) => name !== "")
      .map((name) => decodeURIComponent(name));
  } catch {
    return null;
  }
};

const baseNames = (endpoint: Endpoint) => namesOf(new URL(withSlash(endpoint.url)).pathname) ?? [];

/** The path of an href below the endpoint's collection, or null for one outside it. */
const pathOf = (endpoint: Endpoint, href: string): string[] | null => {
  const base = baseNames(endpoint);
  const names = namesOf(new URL(href, withSlash(endpoint.url)).pathname);
  if (names === null || base.some((name, index) => names[index] !== name)) return null;
  return names.slice(base.length);
};

/** Whether one collection holds the other, or they are the same: a copy would reach itself. */
const overlap = (a: Endpoint, b: Endpoint) => {
  if (new URL(a.url).origin !== new URL(b.url).origin) return false;
  const [x, y] = [baseNames(a), baseNames(b)];
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return shorter.every((name, index) => longer[index] === name);
};

const entriesOf = (endpoint: Endpoint, xml: string): Entry[] => {
  const entries: Entry[] = [];
  for (const response of childElements(parseXml(xml, RESPONSE_LIMITS))) {
    if (response.ns !== DAV || response.local !== "response") continue;
    const href = findChild(response, DAV, "href");
    const path = href ? pathOf(endpoint, textOf(href).trim()) : null;
    if (path === null) continue;
    const found = childElements(response)
      .filter((child) => child.ns === DAV && child.local === "propstat")
      .filter((propstat) => / 200 /.test(textOf(findChild(propstat, DAV, "status") ?? propstat)))
      .flatMap((propstat) => {
        const prop = findChild(propstat, DAV, "prop");
        return prop ? childElements(prop) : [];
      });
    const type = found.find((p) => p.ns === DAV && p.local === "resourcetype");
    const length = found.find((p) => p.ns === DAV && p.local === "getcontentlength");
    const etag = found.find((p) => p.ns === DAV && p.local === "getetag");
    entries.push({
      etag: etag ? textOf(etag).trim() : "",
      path,
      kind: type && findChild(type, DAV, "collection") ? "folder" : "file",
      size: length ? Number(textOf(length).trim()) : 0,
      properties: found.filter((p) => p.ns !== DAV),
    });
  }
  return entries;
};

const propfind = async (endpoint: Endpoint, path: readonly string[], depth: "0" | "1") => {
  const response = await send(endpoint, "PROPFIND", path, {
    headers: { depth, "content-type": "application/xml; charset=utf-8" },
    body: ALLPROP,
    folder: depth === "1",
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (response.status !== 207) throw await fail(response, "PROPFIND", path);
  return entriesOf(endpoint, await response.text());
};

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((name, index) => name === b[index]);

/** The entry at a path, or null when there is none. */
const stat = async (endpoint: Endpoint, path: readonly string[]) =>
  (await propfind(endpoint, path, "0"))?.find((entry) => same(entry.path, path)) ?? null;

/** The members of a collection. */
const list = async (endpoint: Endpoint, path: readonly string[]) =>
  ((await propfind(endpoint, path, "1")) ?? []).filter(
    (entry) => entry.path.length === path.length + 1,
  );

/** The SHA-256 of a stream, read to its end. */
const digest = async (body: ReadableStream<Uint8Array> | null): Promise<string> => {
  const hasher = new Bun.CryptoHasher("sha256");
  if (body) for await (const chunk of body) hasher.update(chunk);
  return hasher.digest("hex");
};

const read = async (endpoint: Endpoint, path: readonly string[]) => {
  const response = await send(endpoint, "GET", path);
  if (response.status !== 200) throw await fail(response, "GET", path);
  return response;
};

const hashOf = async (endpoint: Endpoint, path: readonly string[]) =>
  await digest((await read(endpoint, path)).body);

/**
 * Copies one file's content, and returns the SHA-256 of what was read. The write holds only while
 * the target is as the decision saw it: still without the file, or still with the same version.
 */
const copyFile = async (options: MigrateOptions, entry: Entry, seen: Seen): Promise<string> => {
  const source = await read(options.source, entry.path);
  const [toTarget, toHash] = (source.body ?? new Blob([]).stream()).tee();
  const hashed = digest(toHash);
  const condition: Record<string, string> =
    seen.state === "absent"
      ? { "if-none-match": "*" }
      : seen.etag === ""
        ? {}
        : { "if-match": seen.etag };
  const put = await send(options.target, "PUT", entry.path, {
    headers: { "content-length": String(entry.size), ...condition },
    body: toTarget,
  });
  const sourceHash = await hashed;
  if (put.status === 412) {
    await put.body?.cancel();
    throw new MigrationError(`/${entry.path.join("/")} changed on the target during the copy`);
  }
  if (put.status !== 201 && put.status !== 204) throw await fail(put, "PUT", entry.path);
  await put.body?.cancel();
  return sourceHash;
};

const setProperties = async (endpoint: Endpoint, entry: Entry) => {
  if (entry.properties.length === 0) return 0;
  const body = `<?xml version="1.0" encoding="utf-8"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop>${entry.properties
    .map((property) => serializeElement(property, DAV))
    .join("")}</D:prop></D:set></D:propertyupdate>`;
  const response = await send(endpoint, "PROPPATCH", entry.path, {
    headers: { "content-type": "application/xml; charset=utf-8" },
    body,
    folder: entry.kind === "folder",
  });
  if (response.status !== 207) throw await fail(response, "PROPPATCH", entry.path);
  const text = await response.text();
  if (!/ 200 /.test(text) || / (4|5)\d\d /.test(text)) {
    throw new MigrationError(`PROPPATCH /${entry.path.join("/")} did not set every property`);
  }
  return entry.properties.length;
};

interface Seen {
  readonly state: CopyTarget;
  /** The target file's entity tag when it was looked at. */
  readonly etag: string;
}

/** What the target holds where the source holds `entry`. */
const targetState = async (options: MigrateOptions, entry: Entry): Promise<Seen> => {
  const found = await stat(options.target, entry.path);
  if (found === null) return { state: "absent", etag: "" };
  if (found.kind === "folder") return { state: "folder", etag: "" };
  if (entry.kind === "folder" || found.size !== entry.size)
    return { state: "differs", etag: found.etag };
  const [a, b] = await Promise.all([
    hashOf(options.source, entry.path),
    hashOf(options.target, entry.path),
  ]);
  return { state: a === b ? "same" : "differs", etag: found.etag };
};

/** Copies every entry under the source collection to the target collection. */
export const migrate = async (options: MigrateOptions): Promise<MigrateReport> => {
  const report: MigrateReport = {
    created: 0,
    written: 0,
    skipped: 0,
    bytes: 0,
    properties: 0,
    conflicts: [],
  };
  if (overlap(options.source, options.target)) {
    throw new MigrationError("The source and the target overlap; choose collections apart.");
  }
  const root = await stat(options.target, []);
  if (root?.kind !== "folder") {
    throw new MigrationError("The target is not a collection that this key can reach.");
  }
  if ((await stat(options.source, []))?.kind !== "folder") {
    throw new MigrationError("The source is not a collection that this key can reach.");
  }
  const pending: (readonly string[])[] = [[]];
  for (let folder = pending.pop(); folder !== undefined; folder = pending.pop()) {
    for (const entry of await list(options.source, folder)) {
      const seen = await targetState(options, entry);
      const action = decideMigration(entry.kind, seen.state, options.overwrite ?? false);
      const path = `/${entry.path.join("/")}`;
      if (action === "conflict") {
        report.conflicts.push(path);
        options.onEntry?.({ path, action });
        continue;
      }
      if (action === "create") {
        const response = await send(options.target, "MKCOL", entry.path, { folder: true });
        if (response.status !== 201) throw await fail(response, "MKCOL", entry.path);
        report.created += 1;
      } else if (action === "write") {
        const sourceHash = await copyFile(options, entry, seen);
        if ((await hashOf(options.target, entry.path)) !== sourceHash) {
          throw new MigrationError(`${path} reads back different from the source`);
        }
        report.written += 1;
        report.bytes += entry.size;
      } else {
        report.skipped += 1;
      }
      // What a run creates or writes gets the source's dead properties; what it skips keeps its own.
      if (action !== "skip") report.properties += await setProperties(options.target, entry);
      if (entry.kind === "folder") pending.push(entry.path);
      options.onEntry?.({ path, action });
    }
  }
  return report;
};

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

/** The path of an href below the endpoint's collection, or null for one outside it. */
const pathOf = (endpoint: Endpoint, href: string): string[] | null => {
  const base = new URL(withSlash(endpoint.url)).pathname;
  const pathname = new URL(href, withSlash(endpoint.url)).pathname;
  if (!`${pathname}/`.startsWith(base)) return null;
  return pathname
    .slice(base.length)
    .split("/")
    .filter((name) => name !== "")
    .map((name) => decodeURIComponent(name));
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
    entries.push({
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

/** Copies one file's content, and returns the SHA-256 of what was read. */
const copyFile = async (options: MigrateOptions, entry: Entry): Promise<string> => {
  const source = await read(options.source, entry.path);
  const [toTarget, toHash] = (source.body ?? new Blob([]).stream()).tee();
  const hashed = digest(toHash);
  const put = await send(options.target, "PUT", entry.path, {
    headers: { "content-length": String(entry.size) },
    body: toTarget,
  });
  const sourceHash = await hashed;
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

/** What the target holds where the source holds `entry`. */
const targetState = async (options: MigrateOptions, entry: Entry): Promise<CopyTarget> => {
  const found = await stat(options.target, entry.path);
  if (found === null) return "absent";
  if (found.kind === "folder") return "folder";
  if (entry.kind === "folder" || found.size !== entry.size) return "differs";
  const [a, b] = await Promise.all([
    hashOf(options.source, entry.path),
    hashOf(options.target, entry.path),
  ]);
  return a === b ? "same" : "differs";
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
      const action = decideMigration(
        entry.kind,
        await targetState(options, entry),
        options.overwrite ?? false,
      );
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
        const sourceHash = await copyFile(options, entry);
        if ((await hashOf(options.target, entry.path)) !== sourceHash) {
          throw new MigrationError(`${path} reads back different from the source`);
        }
        report.written += 1;
        report.bytes += entry.size;
      } else {
        report.skipped += 1;
      }
      report.properties += await setProperties(options.target, entry);
      if (entry.kind === "folder") pending.push(entry.path);
      options.onEntry?.({ path, action });
    }
  }
  return report;
};

import { childElements, DAV, parseXml, textOf, type XmlElement } from "@davloom/webdav/xml";
import { basic, startWorkersServer, type Davloom } from "./davloom";
import { hasDocker, startSelfHostedServer } from "./selfhosted";
import type { Server } from "./servers";

// What the black-box protocol tables share: the targets they run against, a folder of the `files`
// Mount that stands in for the namespace root an in-process table builds its world in, and a
// snapshot of a folder taken over WebDAV, as the in-process tables take one of a backend.

export const TARGETS: readonly (readonly [
  name: string,
  start: () => Promise<Server>,
  skip: boolean,
])[] = [
  ["Workers with D1 and Durable Objects", startWorkersServer, false],
  ["Bun with SQLite and RustFS", startSelfHostedServer, !hasDocker()],
];

export interface Call {
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** The API Key to send; the read-write key when absent. */
  readonly key?: string;
}

export interface Folder {
  /** The server's origin, as a Destination or If header names it. */
  readonly origin: string;
  /** The folder's path, like `/dav/files/range-1`, with no trailing slash. */
  readonly base: string;
  /** Sends a request; `path` follows the base path raw, as a client would send it. */
  readonly dav: (method: string, path: string, call?: Call) => Promise<Response>;
  readonly put: (
    path: string,
    body?: string,
    headers?: Record<string, string>,
  ) => Promise<Response>;
  readonly mkcol: (path: string) => Promise<Response>;
}

/** A folder at `base`, which must already exist unless it is a Mount or the WebDAV root. */
export const folderAt = (davloom: Davloom, base: string): Folder => {
  const dav = async (method: string, path: string, call: Call = {}) =>
    await davloom.server.fetch(`${base}${path}`, {
      method,
      headers: { authorization: basic(call.key ?? davloom.readWriteKey), ...call.headers },
      body: call.body,
    });
  return {
    origin: davloom.server.url,
    base,
    dav,
    put: async (path, body = "", headers) => {
      const response = await dav("PUT", path, { body, headers });
      await response.body?.cancel();
      return response;
    },
    mkcol: async (path) => {
      const response = await dav("MKCOL", path);
      await response.body?.cancel();
      return response;
    },
  };
};

let folders = 0;

/** Creates a new, empty folder of the `files` Mount, named after the table. */
export const newFolder = async (davloom: Davloom, table: string): Promise<Folder> => {
  folders += 1;
  const base = `/dav/files/${table}-${folders}`;
  const response = await folderAt(davloom, "/dav").mkcol(base.slice("/dav".length));
  if (response.status !== 201) throw new Error(`MKCOL ${base} answered ${response.status}`);
  return folderAt(davloom, base);
};

/** Builds a tree in a folder: names ending in `/` are collections, the others files. */
export const build = async (folder: Folder, tree: Readonly<Record<string, string>>) => {
  for (const [path, content] of Object.entries(tree)) {
    const response = path.endsWith("/")
      ? await folder.mkcol(path.slice(0, -1))
      : await folder.put(path, content);
    if (response.status !== 201) throw new Error(`creating ${path} answered ${response.status}`);
  }
};

const elementsOf = (element: XmlElement) => childElements(element);

/** The responses of a multistatus body: each href with its properties found (200), by name. */
export const responsesOf = (xml: string) =>
  elementsOf(parseXml(xml)).map((response) => {
    const href = elementsOf(response).find((child) => child.ns === DAV && child.local === "href");
    const found: XmlElement[] = [];
    for (const propstat of elementsOf(response).filter((child) => child.local === "propstat")) {
      const status = elementsOf(propstat).find((child) => child.local === "status");
      const prop = elementsOf(propstat).find((child) => child.local === "prop");
      if (status && prop && / 200 /.test(textOf(status))) found.push(...elementsOf(prop));
    }
    return { href: href ? textOf(href) : "", found };
  });

const ALLPROP =
  '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';

/**
 * Every entry under a folder path with its kind, content and dead properties, keyed by its path
 * relative to the folder, a collection's ending in `/`, like the in-process tables' `snapshot`.
 */
export const snapshot = async (
  folder: Folder,
  path = "",
  { content = true }: { readonly content?: boolean } = {},
): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  const visit = async (at: string) => {
    const response = await folder.dav("PROPFIND", `${encodePath(at)}/`, {
      headers: { depth: "1", "content-type": "application/xml" },
      body: ALLPROP,
    });
    if (response.status !== 207) {
      await response.body?.cancel();
      return;
    }
    const prefix = `${folder.base}${at}/`;
    for (const { href, found } of responsesOf(await response.text())) {
      const name = decodeURIComponent(href.replace(/^https?:\/\/[^/]+/, ""));
      if (!name.startsWith(decodeURIComponent(prefix)) || name === decodeURIComponent(prefix))
        continue;
      const key = `${at}/${name.slice(decodeURIComponent(prefix).length)}`;
      const dead = found
        .filter((prop) => prop.ns !== DAV)
        .map((prop) => `{${prop.ns}}${prop.local}=${textOf(prop)}`)
        .toSorted();
      const props = JSON.stringify(dead);
      const collection = found.some(
        (prop) =>
          prop.ns === DAV &&
          prop.local === "resourcetype" &&
          elementsOf(prop).some((child) => child.local === "collection"),
      );
      if (collection) {
        result[key.endsWith("/") ? key : `${key}/`] = `collection ${props}`;
        await visit(key.replace(/\/$/, ""));
      } else if (content) {
        const read = await folder.dav("GET", encodePath(key));
        result[key] = `file ${await read.text()} ${props}`;
      } else {
        // Without the content, a file's entity tag tells whether it changed.
        const etag = found.find((prop) => prop.ns === DAV && prop.local === "getetag");
        result[key] = `file ${etag ? textOf(etag) : ""} ${props}`;
      }
    }
  };
  await visit(path);
  return result;
};

/** Whether a path of the folder names a resource, as PROPFIND with Depth 0 tells. */
export const exists = async (folder: Folder, path: string) => {
  const response = await folder.dav("PROPFIND", path, { headers: { depth: "0" } });
  await response.body?.cancel();
  if (response.status !== 207 && response.status !== 404) {
    throw new Error(`PROPFIND ${path} answered ${response.status}`);
  }
  return response.status === 207;
};

/** Percent-encodes each name of a path, keeping the slashes. */
export const encodePath = (path: string) =>
  path
    .split("/")
    .map((name) => encodeURIComponent(name))
    .join("/");

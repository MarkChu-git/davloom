import { createMemoryStorage, type MemoryStorageOptions, type StorageBackend } from "@davloom/core";
import { createWebDavHandler, type WebDavOptions } from "../handler";
import { createMemoryLockStore } from "../locks";
import { childElements, DAV, parseXml, textOf, type XmlElement } from "../xml";

export const ORIGIN = "https://dav.example";
export const BASE = "/dav";

export interface Call {
  readonly headers?: Record<string, string>;
  readonly body?: string | Uint8Array<ArrayBuffer>;
}

export const setup = (
  options: Partial<WebDavOptions> & {
    storageOptions?: MemoryStorageOptions;
    locking?: boolean;
  } = {},
) => {
  let time = Date.UTC(2026, 10, 24, 12, 0, 0);
  const now = () => time;
  const storage: StorageBackend =
    options.storage ?? createMemoryStorage({ now, ...options.storageOptions });
  const handler = createWebDavHandler({
    basePath: BASE,
    storage,
    now,
    ...(options.locking === false ? {} : { locks: createMemoryLockStore() }),
    ...options,
  });
  const dav = async (method: string, path: string, call: Call = {}) =>
    await handler(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method,
        headers: call.headers,
        body:
          call.body === undefined
            ? undefined
            : typeof call.body === "string"
              ? call.body
              : new Blob([call.body]),
      }),
    );
  const put = (path: string, body = "", headers?: Record<string, string>) =>
    dav("PUT", path, { body, headers });
  const mkcol = (path: string) => dav("MKCOL", path);
  return {
    storage,
    dav,
    put,
    mkcol,
    advance: (ms: number) => {
      time += ms;
    },
  };
};

export const propfindBody = (inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:">${inner}</D:propfind>`;

export interface ParsedResponse {
  readonly href: string;
  /** Each propstat's properties, by the status line's code. */
  readonly propstats: Record<number, XmlElement[]>;
}

const elementsOf = (element: XmlElement): XmlElement[] => {
  for (const child of element.children) {
    if (typeof child === "string" && child.trim() !== "") {
      throw new Error(`text ${JSON.stringify(child)} in <${element.local}>`);
    }
  }
  return childElements(element);
};

const only = (element: XmlElement, local: string): XmlElement => {
  const found = elementsOf(element).filter((child) => child.ns === DAV && child.local === local);
  const [first] = found;
  if (!first || found.length !== 1) {
    throw new Error(`${found.length} <D:${local}> in <${element.local}>`);
  }
  return first;
};

/**
 * Reads an RFC 4918 §14.16 multistatus body with an XML parser, and fails on text where the
 * grammar has only elements.
 */
export const multistatus = (xml: string): ParsedResponse[] => {
  const root = parseXml(xml);
  if (root.ns !== DAV || root.local !== "multistatus") throw new Error("not a multistatus");
  return elementsOf(root).map((response) => {
    const propstats: Record<number, XmlElement[]> = {};
    for (const propstat of elementsOf(response).filter((child) => child.local === "propstat")) {
      const status = Number(/^HTTP\/1\.1 (\d{3}) /.exec(textOf(only(propstat, "status")))?.[1]);
      if (propstats[status]) throw new Error(`two propstats with status ${status}`);
      const props = elementsOf(only(propstat, "prop"));
      if (props.length === 0) throw new Error("an empty propstat");
      propstats[status] = props;
    }
    return { href: textOf(only(response, "href")), propstats };
  });
};

/** The local names of the properties in one propstat of a response. */
export const names = (response: ParsedResponse | undefined, status: number) =>
  (response?.propstats[status] ?? []).map((prop) =>
    prop.ns === DAV ? prop.local : `{${prop.ns}}${prop.local}`,
  );

/** The text of one property in one propstat of a response. */
export const valueOf = (response: ParsedResponse | undefined, local: string, status = 200) => {
  const prop = response?.propstats[status]?.find((p) => p.ns === DAV && p.local === local);
  return prop ? textOf(prop) : undefined;
};

/** The hrefs and status lines of a multistatus body, in order. */
export const hrefs = (xml: string) =>
  [...xml.matchAll(/<D:href>([^<]*)<\/D:href>/g)].map((m) => m[1]);

import { createMemoryStorage, type MemoryStorageOptions, type StorageBackend } from "@davloom/core";
import { createWebDavHandler, type WebDavOptions } from "../handler";
import { createMemoryLockStore } from "../locks";

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

/** The hrefs and status lines of a multistatus body, in order. */
export const hrefs = (xml: string) =>
  [...xml.matchAll(/<D:href>([^<]*)<\/D:href>/g)].map((m) => m[1]);

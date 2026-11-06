import { notImplementedHandler, type WebDavHandler } from "@davloom/webdav";
import { Elysia, type ElysiaAdapter } from "elysia";

export interface AppOptions {
  /** Elysia picks its Bun adapter by default. Workers must pass the Cloudflare adapter. */
  readonly adapter?: ElysiaAdapter;
  readonly webdavHandler?: WebDavHandler;
}

export const createApp = ({ adapter, webdavHandler = notImplementedHandler }: AppOptions = {}) =>
  new Elysia(adapter ? { adapter } : {})
    .get("/api/health", () => ({ status: "ok" }))
    // Elysia must leave the body unread and the path undecoded: the handler gets the raw request.
    .all("/dav/*", ({ request }) => webdavHandler(request), { parse: "none" });

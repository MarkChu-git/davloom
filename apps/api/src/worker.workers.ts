import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { env } from "cloudflare:workers";
import { configuredOrigin } from "@davloom/auth";
import { createApp } from "./app";
import { withFixedLength } from "./fixed-length.workers";
import { workersInstance } from "./instance.workers";

/** Serves the Dashboard's files: Workers static assets, or the embedded build of a fallback deploy. */
export type DashboardFetcher = (request: Request) => Response | Promise<Response>;

/**
 * The Worker: the API, WebDAV and the root path, which answers GET and HEAD with the Dashboard
 * that `dashboard` serves. Call it at global scope: compile() generates code, which Workers forbid
 * while handling a request.
 */
export const createWorker = (dashboard: DashboardFetcher) => {
  const app = createApp({
    adapter: CloudflareAdapter,
    instance: workersInstance,
    publicOrigin: configuredOrigin(env.DAVLOOM_URL),
    dashboard,
  }).compile();
  return {
    fetch: async (request: Request) => withFixedLength(request, await app.fetch(request)),
  };
};

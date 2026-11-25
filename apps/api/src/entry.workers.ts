import { env } from "cloudflare:workers";
import { createWorker } from "./worker.workers";

export { StorageObject } from "@davloom/storage/durable-object";

// Workers static assets serve the Dashboard. The Worker runs first for /api, /dav and the root
// path (wrangler.jsonc), and hands GET and HEAD of the root back to the assets.
export default createWorker((request) =>
  env.ASSETS ? env.ASSETS.fetch(request) : new Response(null, { status: 404 }),
);

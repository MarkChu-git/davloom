import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { env } from "cloudflare:workers";
import { configuredOrigin } from "@davloom/auth";
import { createApp } from "./app";
import { withFixedLength } from "./fixed-length.workers";
import { workersInstance } from "./instance.workers";

export { StorageObject } from "@davloom/storage/durable-object";

// compile() has to run at global scope: Workers forbid generating code while handling a request.
const app = createApp({
  adapter: CloudflareAdapter,
  instance: workersInstance,
  publicOrigin: configuredOrigin(env.DAVLOOM_URL),
}).compile();

export default {
  fetch: async (request: Request) => withFixedLength(request, await app.fetch(request)),
};

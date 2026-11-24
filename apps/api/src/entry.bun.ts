import { resolve } from "node:path";
import { configuredOrigin } from "@davloom/auth";
import { createApp } from "./app";
import { createDashboardHandler } from "./dashboard.bun";
import { bunInstance, ensureDefaultBucket } from "./instance.bun";
import { serveNode } from "./node-server.bun";

const DEFAULT_DASHBOARD_DIRECTORY = resolve(import.meta.dirname, "../../web/dist/client");

const serveDashboard = createDashboardHandler(
  process.env.DASHBOARD_DIRECTORY ?? DEFAULT_DASHBOARD_DIRECTORY,
);

await ensureDefaultBucket(process.env);

const app = createApp({
  instance: bunInstance(process.env),
  allowHttp: process.env.DAVLOOM_ALLOW_HTTP === "1",
  publicOrigin: configuredOrigin(process.env.DAVLOOM_URL),
})
  // Not `.get`: Elysia prefers a method's own routes over `.all`, so `.get("/*")` would take GET and
  // HEAD away from the WebDAV routes.
  .all("/*", ({ request }) => serveDashboard(request), { parse: "none" });

// node:http rather than Elysia's Bun.serve, which drops the Content-Length of streamed bodies.
const { url } = await serveNode((request) => app.handle(request), {
  hostname: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
});

console.log(`listening on ${url}`);

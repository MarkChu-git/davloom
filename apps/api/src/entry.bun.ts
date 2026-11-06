import { resolve } from "node:path";
import { createApp } from "./app";
import { createDashboardHandler } from "./dashboard.bun";

const DEFAULT_DASHBOARD_DIRECTORY = resolve(import.meta.dirname, "../../web/dist/client");

const serveDashboard = createDashboardHandler(
  process.env.DASHBOARD_DIRECTORY ?? DEFAULT_DASHBOARD_DIRECTORY,
);

const app = createApp()
  // Not `.get`: Elysia prefers a method's own routes over `.all`, so `.get("/*")` would take GET and
  // HEAD away from the WebDAV routes.
  .all("/*", ({ request }) => serveDashboard(request), { parse: "none" })
  .listen({
    hostname: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
  });

console.log(`listening on ${app.server?.url}`);

// Serves a Worker on local workerd through Miniflare until the process gets SIGINT or SIGTERM.
// Playwright starts it as the web server of its Workers project, and `dev:workers` in `apps/api`
// starts it for development. It bundles the Worker once, so restart it after changing the code.
// Usage: bun scripts/serve-workers.ts <Wrangler config, relative to the repository root> <port>
//
// It installs no signal handlers: Miniflare stops workerd and exits on those signals itself, and
// `servers.ts` removes the bundle when the process exits.
import { startWorkerdServer } from "../http/servers";

const [configPath, port] = process.argv.slice(2);
if (!configPath || !port) {
  console.error("Usage: bun scripts/serve-workers.ts <wrangler config> <port>");
  process.exit(1);
}

const server = await startWorkerdServer(configPath, { port: Number(port) });
console.log(`listening on ${server.url}`);

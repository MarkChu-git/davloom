// Serves a Worker on local workerd through Miniflare until the process gets SIGINT, SIGTERM or
// SIGHUP. Playwright starts it as the web server of its Workers project, and `dev:workers` in
// `apps/api` starts it for development. It bundles the Worker once, so restart it after changing
// the code.
// Usage: bun scripts/serve-workers.ts <Wrangler config, relative to the repository root> <port>
// DAVLOOM_SECRET, DAVLOOM_CHECK_LEAKED_PASSWORDS and DAVLOOM_URL in the environment become the
// Worker's vars.
//
// It installs no signal handlers of its own. On those signals, `servers.ts` stops the bundler,
// removes the bundle and exits the process, also while the Worker is still bundling, and on exit
// Miniflare stops workerd.
import { startWorkerdServer } from "../http/servers";

const [configPath, port] = process.argv.slice(2);
if (!configPath || !port) {
  console.error("Usage: bun scripts/serve-workers.ts <wrangler config> <port>");
  process.exit(1);
}

// The instance's secrets come from the environment, as `wrangler secret put` gives them to a
// deployment, so that Playwright can start a Worker that signs sessions and registers its owner.
const vars = Object.fromEntries(
  ["DAVLOOM_SECRET", "DAVLOOM_CHECK_LEAKED_PASSWORDS", "DAVLOOM_URL"].flatMap((name) => {
    const value = process.env[name];
    return value === undefined || value === "" ? [] : [[name, value]];
  }),
);

const server = await startWorkerdServer(configPath, { port: Number(port), vars });
console.log(`listening on ${server.url}`);

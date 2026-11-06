// Serves a Worker on local workerd through Miniflare until it is stopped. Playwright starts it as the
// web server of its Workers project.
// Usage: bun scripts/serve-workers.ts <Wrangler config, relative to the repository root> <port>
import { startWorkerdServer } from "../http/servers";

const [configPath, port] = process.argv.slice(2);
if (!configPath || !port) {
  console.error("Usage: bun scripts/serve-workers.ts <wrangler config> <port>");
  process.exit(1);
}

const server = await startWorkerdServer(configPath, { port: Number(port) });
console.log(`listening on ${server.url}`);

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const BUN_PORT = 4310;
const WORKERS_PORT = 4311;

// Lets a machine reuse a browser it already has instead of `playwright install chromium`.
const executablePath = process.env.DAVLOOM_CHROMIUM_PATH;

// Every spec runs against the production build, delivered both ways.
export default defineConfig({
  testDir: "./ui",
  forbidOnly: true,
  fullyParallel: true,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "bun", use: { baseURL: `http://127.0.0.1:${BUN_PORT}` } },
    { name: "workers", use: { baseURL: `http://127.0.0.1:${WORKERS_PORT}` } },
  ],
  webServer: [
    {
      command: "bun apps/api/src/entry.bun.ts",
      cwd: REPO_ROOT,
      env: { HOST: "127.0.0.1", PORT: String(BUN_PORT) },
      url: `http://127.0.0.1:${BUN_PORT}/api/health`,
    },
    {
      command: `bunx wrangler dev --config apps/api/wrangler.jsonc --ip 127.0.0.1 --port ${WORKERS_PORT} --inspector-port 0 --show-interactive-dev-session=false`,
      cwd: REPO_ROOT,
      env: { WRANGLER_SEND_METRICS: "false" },
      url: `http://127.0.0.1:${WORKERS_PORT}/api/health`,
    },
  ],
});

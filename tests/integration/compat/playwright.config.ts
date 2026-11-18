import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { DEV_SERVER_ORIGIN, DEV_SERVER_PORT } from "./ui/devServer";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const BUN_PORT = 4310;
const WORKERS_PORT = 4311;

// Lets a machine reuse a browser it already has instead of `playwright install chromium`.
const executablePath = process.env.DAVLOOM_CHROMIUM_PATH;

// Every spec runs against the production build, delivered both ways. `dev-server.spec.ts` also
// opens `vite dev` and compares it with the build that Bun delivers.
export default defineConfig({
  testDir: "./ui",
  forbidOnly: true,
  fullyParallel: true,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    // Dates on the pages show in the browser's time zone, so every machine sees the same text.
    timezoneId: "UTC",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "bun", use: { baseURL: `http://127.0.0.1:${BUN_PORT}` } },
    {
      name: "workers",
      use: { baseURL: `http://127.0.0.1:${WORKERS_PORT}` },
      testIgnore: "dev-server.spec.ts",
    },
  ],
  webServer: [
    {
      command: "bun apps/api/src/entry.bun.ts",
      cwd: REPO_ROOT,
      env: { HOST: "127.0.0.1", PORT: String(BUN_PORT) },
      url: `http://127.0.0.1:${BUN_PORT}/api/health`,
    },
    {
      command: `bun tests/integration/compat/scripts/serve-workers.ts apps/api/wrangler.jsonc ${WORKERS_PORT}`,
      cwd: REPO_ROOT,
      url: `http://127.0.0.1:${WORKERS_PORT}/api/health`,
      // Longer than the 60 s that `servers.ts` gives bundling, so that a bundle step that hangs
      // fails with the harness's message rather than with Playwright's timeout.
      timeout: 90_000,
      // Without it Playwright sends SIGKILL, and the script cannot remove its bundle.
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      // `bun --bun` keeps Vite on Bun: `bun run` inside a package directory ignores `run.bun`.
      command: `bun --bun run dev --host 127.0.0.1 --port ${DEV_SERVER_PORT} --strictPort`,
      cwd: resolve(REPO_ROOT, "apps/web"),
      url: DEV_SERVER_ORIGIN,
    },
  ],
});

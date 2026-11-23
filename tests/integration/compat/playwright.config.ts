import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { DEV_SERVER_PORT } from "./ui/devServer";
import {
  BUN_ORIGIN,
  BUN_PORT,
  DEV_WORKER_ORIGIN,
  DEV_WORKER_PORT,
  SECRET,
  SETUP_TOKEN,
  STATE,
  WORKERS_ORIGIN,
  WORKERS_PORT,
} from "./ui/instances";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

// Lets a machine reuse a browser it already has instead of `playwright install chromium`.
const executablePath = process.env.DAVLOOM_CHROMIUM_PATH;

/** Specs that need no management API: Bun serves the Dashboard but no API yet. */
const WITHOUT_API = [
  "appearance.spec.ts",
  "delivery.spec.ts",
  "interactions.spec.ts",
  "styles.spec.ts",
  "no-api.spec.ts",
];

/** Starts the production Worker in local workerd, with the secrets a deployment sets. */
const worker = (port: number) => ({
  command: `bun tests/integration/compat/scripts/serve-workers.ts apps/api/wrangler.jsonc ${port}`,
  cwd: REPO_ROOT,
  env: { DAVLOOM_SECRET: SECRET, DAVLOOM_SETUP_TOKEN: SETUP_TOKEN },
  url: `http://127.0.0.1:${port}/api/health`,
  // Longer than the 60 s that `servers.ts` gives bundling, so that a bundle step that hangs
  // fails with the harness's message rather than with Playwright's timeout.
  timeout: 90_000,
  // Without it Playwright sends SIGKILL, and the script cannot remove its bundle.
  gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
});

// The Dashboard's production build, delivered three ways. `bun` runs the specs that need no API.
// `workers` runs every other spec against a Worker that `ui/instances.setup.ts` gives an
// administrator, sample files and a signed-in session. `dev` compares `vite dev` with the build
// on a second Worker of its own, so that no other spec changes the data while it compares, and on
// the host name localhost, so that its session cookie is not the first Worker's.
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
    { name: "setup", testMatch: "instances.setup.ts" },
    { name: "bun", use: { baseURL: BUN_ORIGIN }, testMatch: WITHOUT_API },
    {
      name: "workers",
      use: { baseURL: WORKERS_ORIGIN, storageState: STATE.workers },
      dependencies: ["setup"],
      testIgnore: ["dev-server.spec.ts", "no-api.spec.ts", "instances.setup.ts"],
    },
    {
      name: "dev",
      use: { baseURL: DEV_WORKER_ORIGIN, storageState: STATE.dev },
      dependencies: ["setup"],
      testMatch: "dev-server.spec.ts",
    },
  ],
  webServer: [
    {
      command: "bun apps/api/src/entry.bun.ts",
      cwd: REPO_ROOT,
      env: { HOST: "127.0.0.1", PORT: String(BUN_PORT) },
      url: `${BUN_ORIGIN}/api/health`,
    },
    worker(WORKERS_PORT),
    worker(DEV_WORKER_PORT),
    {
      // `bun --bun` keeps Vite on Bun: `bun run` inside a package directory ignores `run.bun`.
      command: `bun --bun run dev --host 127.0.0.1 --port ${DEV_SERVER_PORT} --strictPort`,
      cwd: resolve(REPO_ROOT, "apps/web"),
      env: { DAVLOOM_API_ORIGIN: `http://127.0.0.1:${DEV_WORKER_PORT}` },
      url: `http://127.0.0.1:${DEV_SERVER_PORT}`,
    },
  ],
});

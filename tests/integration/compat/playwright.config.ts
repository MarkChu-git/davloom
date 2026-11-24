import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { DEV_SERVER_PORT } from "./ui/devServer";
import {
  BUN_ORIGIN,
  BUN_PORT,
  DEV_WORKER_ORIGIN,
  DEV_WORKER_PORT,
  OFFLINE_VARS,
  SECRET,
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

/**
 * The core flows (PRD §11): signing in and setup, storage and mounts, credentials, files, settings
 * and the Overview. `workers` runs them at a desktop size, and the projects of `SIZES` run them
 * again at tablet and phone sizes.
 */
const CORE_FLOWS = [
  "auth.spec.ts",
  "storage.spec.ts",
  "credentials.spec.ts",
  "file-explorer-browsing.spec.ts",
  "file-explorer-changes.spec.ts",
  "settings.spec.ts",
  "overview.spec.ts",
];

/**
 * A tablet, and phones from the narrowest the owner checks, 320 px, to the widest, 430 px, in light
 * and dark. The tablet keeps the side navigation beside a narrow page; the phones have a Menu
 * button in its place. `ui/helpers.ts` says which layout a width gets, so that a test takes either.
 */
const SIZES = [
  { name: "tablet", viewport: { width: 820, height: 1180 }, colorScheme: "light" },
  { name: "phone", viewport: { width: 390, height: 844 }, colorScheme: "light" },
  { name: "phone-320", viewport: { width: 320, height: 640 }, colorScheme: "light" },
  { name: "phone-360-dark", viewport: { width: 360, height: 780 }, colorScheme: "dark" },
  { name: "phone-430-dark", viewport: { width: 430, height: 932 }, colorScheme: "dark" },
] as const;

/** Firefox and WebKit: at a desktop size with every Worker spec, and at a tablet and phone size. */
const OTHER_BROWSERS: {
  name: string;
  device: "Desktop Firefox" | "Desktop Safari";
  viewport?: { width: number; height: number };
  colorScheme?: "light" | "dark";
  testMatch?: string[];
}[] = [
  { name: "firefox", device: "Desktop Firefox" },
  { name: "webkit", device: "Desktop Safari" },
  {
    name: "webkit-phone",
    device: "Desktop Safari",
    viewport: { width: 390, height: 844 },
    testMatch: CORE_FLOWS,
  },
  {
    name: "firefox-tablet-dark",
    device: "Desktop Firefox",
    viewport: { width: 820, height: 1180 },
    colorScheme: "dark",
    testMatch: CORE_FLOWS,
  },
];

/** Starts the production Worker in local workerd, with the secrets a deployment sets. */
const worker = (port: number) => ({
  command: `bun tests/integration/compat/scripts/serve-workers.ts apps/api/wrangler.jsonc ${port}`,
  cwd: REPO_ROOT,
  env: { DAVLOOM_SECRET: SECRET, ...OFFLINE_VARS },
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
    // A test tagged @desktop sets the windows it checks itself, so at another size it would run
    // the same case again.
    ...SIZES.map(({ name, viewport, colorScheme }) => ({
      name,
      use: { baseURL: WORKERS_ORIGIN, storageState: STATE.workers, viewport, colorScheme },
      dependencies: ["setup"],
      testMatch: CORE_FLOWS,
      grepInvert: /@desktop/,
    })),
    // Every Worker spec again in Firefox and WebKit at a desktop size, and the core flows on a
    // WebKit phone and a Firefox tablet (PRD §11: the core flows in three browsers).
    ...OTHER_BROWSERS.map(({ name, device, viewport, colorScheme, testMatch }) => ({
      name,
      use: {
        ...devices[device],
        baseURL: WORKERS_ORIGIN,
        storageState: STATE.workers,
        timezoneId: "UTC",
        launchOptions: {},
        ...(viewport ? { viewport } : {}),
        ...(colorScheme ? { colorScheme } : {}),
      },
      dependencies: ["setup"],
      ...(testMatch
        ? { testMatch, grepInvert: /@desktop/ }
        : { testIgnore: ["dev-server.spec.ts", "no-api.spec.ts", "instances.setup.ts"] }),
    })),
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

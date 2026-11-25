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
 * The core flows (PRD §11): signing in and setup, finding one's way, storage and mounts,
 * credentials and access, files and their names, settings and preferences, and the Overview. They
 * run in Chromium, Firefox and WebKit, each at a desktop, a tablet and a phone size: `workers`,
 * `firefox` and `webkit` at a desktop size, the projects of `SIZES` and `OTHER_BROWSERS` at the
 * others.
 */
const CORE_FLOWS = [
  "auth.spec.ts",
  "navigation.spec.ts",
  "storage.spec.ts",
  "credentials.spec.ts",
  "access.spec.ts",
  "file-explorer-browsing.spec.ts",
  "file-explorer-changes.spec.ts",
  "file-names.spec.ts",
  "settings.spec.ts",
  "preferences.spec.ts",
  "overview.spec.ts",
];

/** The screenshot regression, which its own projects run (`SCREENSHOT_SIZES`). */
const SCREENSHOTS = "screenshots.spec.ts";

/** Specs that only desktop Chromium runs (PRD §11): the large directory lists. */
const DESKTOP_CHROMIUM_ONLY = ["large-lists.spec.ts"];

/** What `workers` leaves to other projects. */
const NOT_ON_WORKERS = ["dev-server.spec.ts", "no-api.spec.ts", "instances.setup.ts", SCREENSHOTS];

/**
 * The screenshots' three sizes (PRD §11: 30 screenshot cases at three sizes in Chromium). They show
 * data of their own (ui/screens.ts) on the Dashboard that Bun serves, so no other test changes
 * what they show.
 */
const SCREENSHOT_SIZES = [
  { name: "screenshots-desktop", viewport: { width: 1280, height: 720 } },
  { name: "screenshots-tablet", viewport: { width: 820, height: 1180 } },
  { name: "screenshots-phone", viewport: { width: 390, height: 844 } },
] as const;

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

/**
 * Firefox and WebKit: at a desktop size with every Worker spec but the large lists, and with the
 * core flows at a tablet and a phone size.
 */
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
    name: "webkit-tablet",
    device: "Desktop Safari",
    viewport: { width: 820, height: 1180 },
    testMatch: CORE_FLOWS,
  },
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
  {
    name: "firefox-phone",
    device: "Desktop Firefox",
    viewport: { width: 390, height: 844 },
    testMatch: CORE_FLOWS,
  },
];

/**
 * origin that the browser reaches it on, when it has one, which passkeys need.
 * origin that the browser reaches it on, which passkeys need.
 */
const worker = (port: number, origin?: string) => ({
  command: `bun tests/integration/compat/scripts/serve-workers.ts apps/api/wrangler.jsonc ${port}`,
  cwd: REPO_ROOT,
  env: { DAVLOOM_SECRET: SECRET, ...(origin ? { DAVLOOM_URL: origin } : {}), ...OFFLINE_VARS },
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
  // The baselines of the screenshot projects, one folder per project, committed with the specs.
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  expect: {
    // Animations stop, and a few pixels of anti-aliasing may differ between runs of the image.
    toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.001 },
  },
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
      testIgnore: NOT_ON_WORKERS,
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
    // tablet and a phone in each (PRD §11: the core flows in three browsers at three sizes).
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
        : { testIgnore: [...NOT_ON_WORKERS, ...DESKTOP_CHROMIUM_ONLY] }),
    })),
    ...SCREENSHOT_SIZES.map(({ name, viewport }) => ({
      name,
      use: { baseURL: BUN_ORIGIN, viewport },
      testMatch: SCREENSHOTS,
    })),
  ],
  webServer: [
    {
      command: "bun apps/api/src/entry.bun.ts",
      cwd: REPO_ROOT,
      env: { HOST: "127.0.0.1", PORT: String(BUN_PORT) },
      url: `${BUN_ORIGIN}/api/health`,
    },
    worker(WORKERS_PORT, WORKERS_ORIGIN),
    // The dev server reaches this Worker through its proxy as 127.0.0.1 and the build as
    // localhost, so it names no public origin and takes each request's own.
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

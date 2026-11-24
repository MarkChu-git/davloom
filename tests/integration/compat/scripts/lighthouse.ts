// Runs Lighthouse on every Dashboard page of the production build, in local workerd, with the
// desktop and the mobile preset, and fails when the median score of any category is below
// THRESHOLD. `bun run lighthouse` from the repository root; CI's `lighthouse` job runs the same.
//
//   bun run lighthouse                 builds the Dashboard first
//   bun run lighthouse --no-build      measures the build in apps/web/dist as it is
//   bun run lighthouse --only=sign-in  measures the pages whose name or path contains the text
//
// It writes the HTML report of each page's median run and summary.json to reports/lighthouse/.
// Chromium is DAVLOOM_CHROMIUM_PATH, or else the one `playwright install chromium` downloaded.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { launch } from "chrome-launcher";
import lighthouse, { type Config, type Flags, type Result } from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { computeMedianRun } from "lighthouse/core/lib/median-run.js";
import { ReportGenerator } from "lighthouse/report/generator/report-generator.js";
import { ADMIN, SETUP_TOKEN, startWorkersServer } from "../http/davloom";

/** The lowest median score, out of 100, that any category of any page may have. */
const THRESHOLD = 96;
/** Runs per page and preset; the median of each category's scores counts. */
const DEFAULT_RUNS = 3;
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * What the instance holds when a page is measured. The pages run in this order: `new` before the
 * administrator exists, `signed-out` after, and `signed-in` with the administrator's session.
 */
type State = "new" | "signed-out" | "signed-in";
const STATES: readonly State[] = ["new", "signed-out", "signed-in"];

/** Every Dashboard page. Add a page here; `path` must be where the page stays once it has loaded. */
const PAGES: readonly { name: string; path: string; state: State }[] = [
  { name: "setup", path: "/setup", state: "new" },
  { name: "sign-in", path: "/sign-in", state: "signed-out" },
  { name: "overview", path: "/", state: "signed-in" },
  { name: "files", path: "/files", state: "signed-in" },
  { name: "credentials", path: "/credentials", state: "signed-in" },
  { name: "storage", path: "/storage", state: "signed-in" },
  { name: "settings", path: "/settings", state: "signed-in" },
];

const PRESETS: readonly { name: string; config: Config | undefined }[] = [
  { name: "desktop", config: desktopConfig },
  // Lighthouse's default: a phone on a slow 4G connection with a 4x slower CPU.
  { name: "mobile", config: undefined },
];

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const REPORT_DIRECTORY = resolve(REPO_ROOT, "reports/lighthouse");

const args = process.argv.slice(2);
const option = (name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = option("only");
const RUNS = Number(option("runs") ?? DEFAULT_RUNS);
if (!Number.isInteger(RUNS) || RUNS < 1) {
  console.error(`--runs takes a whole number of at least 1, not ${option("runs")}`);
  process.exit(1);
}
const presets = PRESETS.filter(({ name }) => [undefined, name].includes(option("preset")));
const pages = PAGES.filter(
  ({ name, path }) => only === undefined || name.includes(only) || path.includes(only),
);
if (pages.length === 0) {
  console.error(`No page matches --only=${only}`);
  process.exit(1);
}

if (!args.includes("--no-build")) {
  const build = spawnSync("bun", ["run", "--filter", "@davloom/web", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

interface Measurement {
  readonly page: string;
  readonly path: string;
  readonly preset: string;
  readonly scores: Record<Category, number>;
  readonly metrics: Record<string, number | undefined>;
  readonly failures: readonly string[];
}

const METRICS = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
] as const;

const chromePath = process.env.DAVLOOM_CHROMIUM_PATH || chromium.executablePath();
const server = await startWorkersServer();
const chrome = await launch({
  chromePath,
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
});

rmSync(REPORT_DIRECTORY, { recursive: true, force: true });
mkdirSync(REPORT_DIRECTORY, { recursive: true });

const measurements: Measurement[] = [];

/** Moves the instance on to `state`, and returns the headers its pages are measured with. */
const reach = async (state: State): Promise<Record<string, string>> => {
  if (state === "new") return {};
  const setup = await server.fetch("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...ADMIN, token: SETUP_TOKEN }),
  });
  if (setup.status !== 201 && setup.status !== 409) {
    throw new Error(`setup failed: ${setup.status} ${await setup.text()}`);
  }
  if (state === "signed-out") return {};
  const signIn = await server.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: server.url },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  if (!signIn.ok) throw new Error(`sign-in failed: ${signIn.status} ${await signIn.text()}`);
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie };
};

const measure = async (
  page: (typeof PAGES)[number],
  preset: (typeof PRESETS)[number],
  extraHeaders: Record<string, string>,
): Promise<Measurement> => {
  const url = `${server.url}${page.path}`;
  const runs: Result[] = [];
  for (let run = 0; run < RUNS; run++) {
    const flags: Flags = { port: chrome.port, output: "html", logLevel: "error", extraHeaders };
    const result = await lighthouse(url, flags, preset.config);
    if (result === undefined) throw new Error(`Lighthouse returned nothing for ${url}`);
    const { lhr } = result;
    if (lhr.runtimeError !== undefined) {
      throw new Error(`Lighthouse could not measure ${url}: ${lhr.runtimeError.message}`);
    }
    // The page that was measured has to be the page asked for, not one it sent the browser on to.
    const landed = new URL(lhr.finalDisplayedUrl).pathname;
    if (landed !== page.path) {
      throw new Error(`${url} ended on ${landed}, so ${page.name} cannot be measured`);
    }
    runs.push(lhr);
  }
  // A category Lighthouse could not score counts as 0.
  const score = (category: Category) =>
    Math.round(median(runs.map((lhr) => (lhr.categories[category]?.score ?? 0) * 100)));
  const scores = {
    performance: score("performance"),
    accessibility: score("accessibility"),
    "best-practices": score("best-practices"),
    seo: score("seo"),
  };
  // The run Lighthouse itself takes as the median, by its first paint and time to interactive:
  // its report and timings are the ones written out, while each score is the median of its own.
  const medianRun: Result = computeMedianRun(runs);
  const metrics = Object.fromEntries(METRICS.map((id) => [id, medianRun.audits[id]?.numericValue]));
  // The report of the median run, rendered again so that it is the one Lighthouse would show.
  writeFileSync(
    resolve(REPORT_DIRECTORY, `${page.name}-${preset.name}.html`),
    ReportGenerator.generateReportHtml(medianRun),
  );
  const failures = CATEGORIES.filter((category) => scores[category] < THRESHOLD).map((category) => {
    const failed = Object.values(medianRun.audits)
      .filter(
        (audit) =>
          audit.score !== null && audit.score < 0.9 && audit.scoreDisplayMode !== "informative",
      )
      .filter((audit) =>
        medianRun.categories[category]?.auditRefs.some(
          (ref) => ref.id === audit.id && ref.weight > 0,
        ),
      )
      .map((audit) => `${audit.id} ${audit.displayValue ?? audit.score}`);
    return `${category} ${scores[category]} < ${THRESHOLD}${failed.length ? ` (${failed.join(", ")})` : ""}`;
  });
  return { page: page.name, path: page.path, preset: preset.name, scores, metrics, failures };
};

try {
  for (const state of STATES) {
    const statePages = pages.filter((page) => page.state === state);
    if (statePages.length === 0) continue;
    const headers = await reach(state);
    for (const page of statePages) {
      for (const preset of presets) {
        const result = await measure(page, preset, headers);
        measurements.push(result);
        const scores = CATEGORIES.map((c) => `${c} ${result.scores[c]}`).join(", ");
        const timing = `FCP ${Math.round(result.metrics["first-contentful-paint"] ?? 0)} ms, LCP ${Math.round(result.metrics["largest-contentful-paint"] ?? 0)} ms, TBT ${Math.round(result.metrics["total-blocking-time"] ?? 0)} ms`;
        console.log(`${page.name} ${preset.name}: ${scores} (${timing})`);
      }
    }
  }
} finally {
  chrome.kill();
  await server.stop();
}

writeFileSync(
  resolve(REPORT_DIRECTORY, "summary.json"),
  `${JSON.stringify({ threshold: THRESHOLD, runs: RUNS, measurements }, null, 2)}\n`,
);
const belowThreshold = measurements.flatMap(({ page, preset, failures }) =>
  failures.map((failure) => `${page} ${preset}: ${failure}`),
);
if (belowThreshold.length > 0) {
  console.error(`\nLighthouse found ${belowThreshold.length} scores below ${THRESHOLD}:`);
  for (const failure of belowThreshold) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`\nEvery category of every page scored at least ${THRESHOLD}.`);

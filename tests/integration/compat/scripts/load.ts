// The scheduled k6 load test: starts the production Worker in local workerd with an administrator
// and an API Key, and runs load/davloom.js in the k6 image
// that scripts/lib/tools.ts pins, which needs Docker. Prints k6's summary, writes it to
// test-results/load/summary.json, adds a table of it to $GITHUB_STEP_SUMMARY when that is set,
// and exits with k6's status: 99 when a threshold failed.
// Usage, from the repository root after `bun run --filter @davloom/web build`:
//   bun tests/integration/compat/scripts/load.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IMAGES, imageReference } from "../../../../scripts/lib/tools";
import { startDavloom } from "../http/davloom";

const COMPAT_DIRECTORY = resolve(import.meta.dirname, "..");
const OUTPUT = resolve(COMPAT_DIRECTORY, "test-results/load");
const k6 = IMAGES.k6;
if (!k6) throw new Error("scripts/lib/tools.ts pins no k6 image");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const numberAt = (value: unknown, key: string): string => {
  const field: unknown = isRecord(value) ? value[key] : undefined;
  return typeof field === "number" ? field.toFixed(1) : "";
};

/** A Markdown table of each operation's latency and whether its threshold held. */
const markdownSummary = (summary: unknown): string => {
  const metrics: unknown = isRecord(summary) ? summary["metrics"] : undefined;
  if (!isRecord(metrics)) return "k6 wrote no metrics.\n";
  const rows = Object.entries(metrics)
    .flatMap(([name, metric]) => {
      const tags = /^http_req_duration\{scenario:(\w+),op:(\w+)\}$/.exec(name);
      if (!tags) return [];
      const thresholds: unknown = isRecord(metric) ? metric["thresholds"] : undefined;
      // k6 records whether each threshold was crossed.
      const crossed = isRecord(thresholds) && Object.values(thresholds).some(Boolean);
      return [
        `| ${tags[1]} | ${tags[2]} | ${numberAt(metric, "med")} | ${numberAt(metric, "p(95)")} | ${numberAt(metric, "max")} | ${crossed ? "crossed" : "held"} |`,
      ];
    })
    .toSorted();
  const failed = isRecord(metrics["http_req_failed"]) ? metrics["http_req_failed"]["value"] : null;
  return [
    "## k6 load test",
    "",
    `Failed requests: ${typeof failed === "number" ? `${(failed * 100).toFixed(2)}%` : "unknown"}`,
    "",
    "| Scenario | Operation | Median ms | p95 ms | Max ms | Threshold |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
};

const run = async (command: readonly string[]) => {
  const child = Bun.spawn([...command], { stdio: ["inherit", "inherit", "inherit"] });
  return await child.exited;
};

const davloom = await startDavloom();
let status = 1;
try {
  const { host, port } = new URL(davloom.server.url);
  mkdirSync(OUTPUT, { recursive: true });
  // Linux shares the host's loopback with the container; Docker Desktop reaches it by name. The
  // Host header stays the loopback address, which the Worker accepts over plain HTTP.
  const linux = process.platform === "linux";
  const baseUrl = linux ? davloom.server.url : `http://host.docker.internal:${port}`;
  const user =
    typeof process.getuid === "function" && typeof process.getgid === "function"
      ? ["--user", `${process.getuid()}:${process.getgid()}`]
      : [];
  status = await run([
    "docker",
    "run",
    "--rm",
    ...(linux ? ["--network", "host"] : []),
    ...user,
    "--volume",
    `${resolve(COMPAT_DIRECTORY, "load")}:/scripts:ro`,
    "--volume",
    `${OUTPUT}:/out`,
    "--env",
    `BASE_URL=${baseUrl}`,
    "--env",
    `HOST=${host}`,
    "--env",
    `API_KEY=${davloom.readWriteKey}`,
    "--env",
    `COOKIE=${davloom.cookie}`,
    "--env",
    "K6_NO_USAGE_REPORT=true",
    imageReference(k6),
    "run",
    "--summary-export=/out/summary.json",
    "/scripts/davloom.js",
  ]);
} finally {
  await davloom.server.stop();
}
const summaryFile = resolve(OUTPUT, "summary.json");
const stepSummary = process.env.GITHUB_STEP_SUMMARY;
if (stepSummary && existsSync(summaryFile)) {
  const summary: unknown = JSON.parse(readFileSync(summaryFile, "utf8"));
  appendFileSync(stepSummary, markdownSummary(summary));
}
process.exit(status);

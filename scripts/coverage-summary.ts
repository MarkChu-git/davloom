// Prints each package's coverage from the json-summary report that `bun run test:coverage`
// writes, as Markdown. The coverage job appends it to its job summary (add-ci-baseline, task 3.3).
// Exits non-zero when the report is missing or a package is below its thresholds.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { thresholds } from "../vitest.config";
import { readFileSummaries, renderMarkdown, summarize } from "./lib/coverage-summary";

const root = fileURLToPath(new URL("..", import.meta.url));
const report = Bun.file(join(root, "coverage", "coverage-summary.json"));

if (!(await report.exists())) {
  console.log(
    "## Coverage per package\n\n`bun run test:coverage` wrote no `coverage/coverage-summary.json`. Vitest writes no coverage report when a test fails, so look for the failing test in the log.\n",
  );
  process.exit(1);
}

const parsed: unknown = await report.json();
const rows = summarize(readFileSummaries(parsed), root, thresholds);
console.log(renderMarkdown(rows));
if (rows.some((row) => row.below.length > 0)) {
  process.exit(1);
}

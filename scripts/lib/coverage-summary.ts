import { relative, sep } from "node:path";

// Per-package coverage for the job summary of the coverage job (add-ci-baseline, task 3.3).
// Vitest checks each threshold against the files whose path, relative to the repository root,
// matches the threshold's glob, using Istanbul's summary of those files. These functions group
// Istanbul's json-summary report the same way, so the table shows the numbers the gate compares.

export const METRICS = ["lines", "branches", "functions", "statements"] as const;
export type Metric = (typeof METRICS)[number];

export interface Counts {
  readonly total: number;
  readonly covered: number;
}

/** One file's entry in Istanbul's `coverage-summary.json`, reduced to the counts. */
export type FileSummary = Readonly<Record<Metric, Counts>>;

export type Limits = Readonly<Partial<Record<Metric, number>>>;
export type Thresholds = Readonly<Record<string, Limits>>;

export interface PackageCoverage {
  /** The threshold's glob, such as `packages/core/src/**`. */
  readonly pattern: string;
  /** The package directory, such as `packages/core`. */
  readonly name: string;
  readonly files: number;
  readonly counts: Readonly<Record<Metric, Counts>>;
  readonly pct: Readonly<Record<Metric, number>>;
  readonly limits: Limits;
  /** The metrics whose coverage is below the package's threshold. */
  readonly below: readonly Metric[];
}

const byMetric = <T>(value: (metric: Metric) => T): Record<Metric, T> => ({
  lines: value("lines"),
  branches: value("branches"),
  functions: value("functions"),
  statements: value("statements"),
});

/** Istanbul's percentage: two decimals rounded down, and 100 when there is nothing to cover. */
export const percent = (covered: number, total: number): number =>
  total > 0 ? Math.floor((1e5 * covered) / total / 10) / 100 : 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readCounts = (file: string, metric: Metric, value: unknown): Counts => {
  if (isRecord(value)) {
    const { total, covered } = value;
    if (typeof total === "number" && typeof covered === "number") {
      return { total, covered };
    }
  }
  throw new Error(`coverage-summary.json has no ${metric} counts for ${file}`);
};

/**
 * Reads the files of a parsed `coverage-summary.json`, leaving out its `total` entry, and fails
 * with the file and metric when an entry lacks a count.
 */
export const readFileSummaries = (report: unknown): Record<string, FileSummary> => {
  if (!isRecord(report)) {
    throw new Error("coverage-summary.json does not hold an object");
  }
  const files: Record<string, FileSummary> = {};
  for (const [file, entry] of Object.entries(report)) {
    if (file === "total") {
      continue;
    }
    if (!isRecord(entry)) {
      throw new Error(`coverage-summary.json has no counts for ${file}`);
    }
    files[file] = byMetric((metric) => readCounts(file, metric, entry[metric]));
  }
  return files;
};

// Vitest matches threshold globs with picomatch, whose `**` skips names that start with a dot.
// Bun.Glob's `**` does not, so a path with such a segment is left out here too.
const matcher = (pattern: string) => {
  const glob = new Bun.Glob(pattern);
  return (path: string): boolean =>
    glob.match(path) && !path.split("/").some((segment) => segment.startsWith("."));
};

// Vitest reads a negative threshold as a maximum count of uncovered items, which the table does
// not show, so the summary refuses it rather than report a percentage the gate does not check.
const checkLimits = (pattern: string, limits: Limits): void => {
  for (const metric of METRICS) {
    const limit = limits[metric];
    if (limit !== undefined && limit < 0) {
      throw new Error(
        `${pattern} sets ${metric} to ${limit}, a count of uncovered items, which coverage:summary does not report`,
      );
    }
  }
};

/** Groups the files by the package globs that carry thresholds, in the order of `thresholds`. */
export const summarize = (
  files: Readonly<Record<string, FileSummary>>,
  root: string,
  thresholds: Thresholds,
): PackageCoverage[] =>
  Object.entries(thresholds).map(([pattern, limits]) => {
    checkLimits(pattern, limits);
    const matches = matcher(pattern);
    const matched = Object.entries(files)
      .filter(([file]) => matches(relative(root, file).split(sep).join("/")))
      .map(([, summary]) => summary);
    const counts = byMetric((metric) =>
      matched.reduce<Counts>(
        (sum, summary) => ({
          total: sum.total + summary[metric].total,
          covered: sum.covered + summary[metric].covered,
        }),
        { total: 0, covered: 0 },
      ),
    );
    const pct = byMetric((metric) => percent(counts[metric].covered, counts[metric].total));
    return {
      pattern,
      name: pattern.replace(/\/src\/\*\*$/, ""),
      files: matched.length,
      counts,
      pct,
      limits,
      below: METRICS.filter((metric) => {
        const limit = limits[metric];
        return limit !== undefined && pct[metric] < limit;
      }),
    };
  });

const cell = (row: PackageCoverage, metric: Metric): string => {
  const { covered, total } = row.counts[metric];
  const limit = row.limits[metric];
  const parts = [`${row.pct[metric]}%`, `${covered}/${total}`];
  if (limit !== undefined) {
    parts.push(row.below.includes(metric) ? `below ${limit}` : `min ${limit}`);
  }
  return parts.join(" · ");
};

const verdict = (rows: readonly PackageCoverage[]): string => {
  const failing = rows.filter((row) => row.below.length > 0).map((row) => `\`${row.name}\``);
  if (failing.length === 0) {
    return `All ${rows.length} packages meet their coverage thresholds.`;
  }
  return failing.length === 1
    ? `${failing[0]} is below its coverage thresholds.`
    : `${failing.length} packages are below their coverage thresholds: ${failing.join(", ")}.`;
};

/** The Markdown that the coverage job appends to its job summary. */
export const renderMarkdown = (rows: readonly PackageCoverage[]): string =>
  [
    "## Coverage per package",
    "",
    verdict(rows),
    "",
    "| Package | Files | Lines | Branches | Functions | Statements |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| \`${row.name}\` | ${row.files} | ${METRICS.map((metric) => cell(row, metric)).join(" | ")} |`,
    ),
    "",
    "Each cell gives the coverage, the covered and total count, and the package's threshold where it has one. The thresholds are in `vitest.config.ts`.",
    "",
  ].join("\n");

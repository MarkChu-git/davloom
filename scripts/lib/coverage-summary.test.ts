import { describe, expect, it } from "vitest";
import {
  type FileSummary,
  percent,
  readFileSummaries,
  renderMarkdown,
  summarize,
} from "./coverage-summary";

const root = "/repo";

const file = (lines: [number, number], branches: [number, number] = [0, 0]): FileSummary => ({
  lines: { covered: lines[0], total: lines[1] },
  branches: { covered: branches[0], total: branches[1] },
  functions: { covered: 0, total: 0 },
  statements: { covered: lines[0], total: lines[1] },
});

describe("percent", () => {
  // Expected values from Istanbul's percent(): Math.floor(1e5 * covered / total / 10) / 100.
  it.each([
    [12, 19, 63.15],
    [2, 3, 66.66],
    [1, 3, 33.33],
    [19, 19, 100],
    [0, 7, 0],
  ])("gives %i of %i as %d", (covered, total, expected) => {
    expect(percent(covered, total)).toBe(expected);
  });

  it("counts a package with nothing to cover as fully covered, as Istanbul does", () => {
    expect(percent(0, 0)).toBe(100);
  });
});

describe("readFileSummaries", () => {
  it("reads every file and leaves out the total", () => {
    const entry = {
      lines: { total: 4, covered: 3, skipped: 0, pct: 75 },
      branches: { total: 2, covered: 1, skipped: 0, pct: 50 },
      functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
      statements: { total: 4, covered: 3, skipped: 0, pct: 75 },
    };
    expect(readFileSummaries({ total: entry, "/repo/packages/a/src/x.ts": entry })).toEqual({
      "/repo/packages/a/src/x.ts": {
        lines: { total: 4, covered: 3 },
        branches: { total: 2, covered: 1 },
        functions: { total: 1, covered: 1 },
        statements: { total: 4, covered: 3 },
      },
    });
  });

  it("names the file and the metric whose counts are missing", () => {
    const report = { "/repo/a.ts": { lines: { total: 1, covered: 1 } } };
    expect(() => readFileSummaries(report)).toThrow("no branches counts for /repo/a.ts");
  });

  it("fails on a report that is not an object", () => {
    expect(() => readFileSummaries([])).toThrow("does not hold an object");
  });
});

describe("summarize", () => {
  const files = {
    "/repo/packages/a/src/x.ts": file([3, 4], [1, 2]),
    "/repo/packages/a/src/deep/y.ts": file([1, 4], [1, 2]),
    "/repo/packages/b/src/z.ts": file([2, 2]),
    "/repo/scripts/tool.ts": file([0, 9]),
  };

  it("adds up the files under each package's glob, in the order of the thresholds", () => {
    const rows = summarize(files, root, {
      "packages/b/src/**": { lines: 100 },
      "packages/a/src/**": { lines: 50, branches: 50 },
    });
    expect(rows.map((row) => [row.name, row.files, row.counts.lines, row.pct.lines])).toEqual([
      ["packages/b", 1, { covered: 2, total: 2 }, 100],
      ["packages/a", 2, { covered: 4, total: 8 }, 50],
    ]);
  });

  it("leaves out files that no threshold names", () => {
    const rows = summarize(files, root, { "packages/b/src/**": { lines: 0 } });
    expect(rows.map((row) => row.counts.lines.total)).toEqual([2]);
  });

  it("marks only the metrics below their threshold, and passes coverage equal to it", () => {
    const [row] = summarize(files, root, {
      "packages/a/src/**": { lines: 50.01, branches: 50 },
    });
    expect(row?.below).toEqual(["lines"]);
  });

  it("checks no metric that has no threshold", () => {
    const [row] = summarize(files, root, { "packages/a/src/**": { branches: 0 } });
    expect(row?.pct.functions).toBe(100);
    expect(row?.below).toEqual([]);
  });

  it("reports a package whose glob matches no file", () => {
    const [row] = summarize(files, root, { "packages/c/src/**": { lines: 0 } });
    expect([row?.files, row?.counts.lines]).toEqual([0, { covered: 0, total: 0 }]);
  });

  // Vitest's picomatch skips them under `**`, so the gate never counts these files.
  it("leaves out files under a name that starts with a dot, as Vitest's matcher does", () => {
    const withHidden = {
      ...files,
      "/repo/packages/a/src/.extra/hidden.ts": file([0, 10]),
      "/repo/packages/a/src/.hidden.ts": file([0, 10]),
    };
    const [row] = summarize(withHidden, root, { "packages/a/src/**": { lines: 50 } });
    expect([row?.files, row?.counts.lines]).toEqual([2, { covered: 4, total: 8 }]);
  });

  it("refuses a negative threshold, which Vitest reads as a count of uncovered items", () => {
    expect(() => summarize(files, root, { "packages/a/src/**": { lines: -10 } })).toThrow(
      "packages/a/src/** sets lines to -10, a count of uncovered items",
    );
  });
});

describe("renderMarkdown", () => {
  const files = {
    "/repo/packages/a/src/x.ts": file([1, 4]),
    "/repo/packages/b/src/z.ts": file([2, 2]),
  };

  it("says that every package meets its thresholds", () => {
    const rows = summarize(files, root, {
      "packages/a/src/**": { lines: 25 },
      "packages/b/src/**": { lines: 100 },
    });
    const markdown = renderMarkdown(rows);
    expect(markdown).toContain("All 2 packages meet their coverage thresholds.");
    expect(markdown).toContain("| `packages/a` | 1 | 25% · 1/4 · min 25 | 100% · 0/0 |");
  });

  it("names the package below its thresholds and the metric that fails", () => {
    const rows = summarize(files, root, {
      "packages/a/src/**": { lines: 25.01 },
      "packages/b/src/**": { lines: 100 },
    });
    const markdown = renderMarkdown(rows);
    expect(markdown).toContain("`packages/a` is below its coverage thresholds.");
    expect(markdown).toContain("| `packages/a` | 1 | 25% · 1/4 · below 25.01 |");
  });

  it("lists every package below its thresholds", () => {
    const rows = summarize(files, root, {
      "packages/a/src/**": { lines: 30 },
      "packages/b/src/**": { branches: 100, lines: 100.01 },
    });
    expect(renderMarkdown(rows)).toContain(
      "2 packages are below their coverage thresholds: `packages/a`, `packages/b`.",
    );
  });
});

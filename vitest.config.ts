import { defineConfig } from "vitest/config";

// Coverage thresholds per package, starting at the coverage measured when the gate was added
// (task 2.5 of add-ci-baseline). They only go up: lowering one needs a reason in the design.md
// of the change that lowers it (PRD §11). Functions are gated where PRD §11 gates them.
// scripts/coverage-thresholds.test.ts fails when a package with sources has no entry here.
export const thresholds = {
  "apps/api/src/**": { lines: 0, branches: 0 },
  "apps/web/src/**": { lines: 0, branches: 0 },
  "packages/auth/src/**": { lines: 63.15, branches: 100 },
  "packages/core/src/**": { lines: 100, branches: 100, functions: 100 },
  "packages/database/src/**": { lines: 0, branches: 100 },
  "packages/ui/src/**": { lines: 0, branches: 100 },
  "packages/webdav/src/**": { lines: 0, branches: 100, functions: 0 },
};

// Unit tests only. Runtime compatibility tests have their own configs in tests/integration/compat.
export default defineConfig({
  test: {
    include: [
      "scripts/**/*.test.ts",
      "packages/*/src/**/*.test.{ts,tsx}",
      "apps/*/src/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "istanbul",
      // Every package, so a package whose files no test loads still appears in the report.
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts", "**/*.gen.ts"],
      // "nested" gives each package one total row, the coverage its thresholds are checked against.
      // Vitest hides fully covered files when it detects an AI agent; list every file everywhere.
      reporter: [["text", { skipFull: false, maxCols: 120, summarizer: "nested" }]],
      thresholds,
    },
  },
});

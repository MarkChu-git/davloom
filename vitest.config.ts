import { fileURLToPath } from "node:url";
import stylex from "@stylexjs/unplugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Coverage thresholds per package, starting at the coverage measured when the gate was added
// (task 2.5 of add-ci-baseline); apps/web and packages/ui rose to their measured coverage with
// task 3.3. They only go up: lowering one needs a reason in the design.md of the change that
// lowers it (PRD §11). Functions are gated where PRD §11 gates them. The branch thresholds of
// core, database, laws and webdav were 100% of packages that held almost no branches; with the
// storage, protocol and instance code they start again at the coverage measured on 2026-11-23.
// packages/storage started at the coverage measured on 2026-11-23, while its Durable Objects adapter
// and R2 driver ran only in workerd; since 2026-11-24 the unit tests also run them on Bun, on
// bun:sqlite and an R2 bucket in memory (packages/storage/test), and its entry is that coverage.
// Every package is at or above the V1 targets of PRD §11 (V1 gates, 2026-11-24).
// scripts/coverage-thresholds.test.ts fails when a package has no src directory or no entry here,
// or when an entry is below its V1 target.
export const thresholds = {
  "apps/api/src/**": { lines: 94, branches: 87 },
  "apps/web/src/**": { lines: 98, branches: 93 },
  "packages/auth/src/**": { lines: 100, branches: 100 },
  "packages/core/src/**": { lines: 100, branches: 98, functions: 100 },
  "packages/database/src/**": { lines: 93, branches: 95 },
  "packages/laws/src/**": { lines: 100, branches: 97 },
  "packages/migrate/src/**": { lines: 100, branches: 89 },
  "packages/schema/src/**": { lines: 100, branches: 86, functions: 100 },
  "packages/storage/src/**": { lines: 99, branches: 92, functions: 98 },
  "packages/ui/src/**": { lines: 100, branches: 100 },
  "packages/webdav/src/**": { lines: 97, branches: 90, functions: 96 },
};

// Unit tests only. Runtime compatibility tests have their own configs in tests/integration/compat.
export default defineConfig({
  resolve: {
    // Workers-only modules get a stand-in, so their wiring runs in the unit tests too.
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("scripts/test/cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "scripts/**/*.test.ts",
            "packages/*/src/**/*.test.ts",
            "apps/*/src/**/*.test.ts",
          ],
        },
      },
      {
        // React components in happy-dom, compiled as the Dashboard's build compiles them.
        extends: true,
        plugins: [
          stylex({
            useCSSLayers: true,
            debug: false,
            unstable_moduleResolution: { type: "commonJS" },
          }),
          react(),
        ],
        test: {
          name: "components",
          environment: "happy-dom",
          include: ["apps/web/src/**/*.test.tsx", "packages/ui/src/**/*.test.tsx"],
        },
      },
    ],
    coverage: {
      provider: "istanbul",
      // Every package, so a package whose files no test loads still appears in the report.
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts", "**/*.gen.ts"],
      // "nested" gives each package one total row, the coverage its thresholds are checked against.
      // Vitest hides fully covered files when it detects an AI agent; list every file everywhere.
      // json-summary writes coverage/coverage-summary.json, which scripts/coverage-summary.ts
      // turns into the coverage job's summary.
      reporter: [
        ["text", { skipFull: false, maxCols: 120, summarizer: "nested" }],
        ["json-summary", {}],
      ],
      thresholds,
    },
  },
});

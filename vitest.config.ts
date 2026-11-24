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
// packages/storage holds the object-store adapter and its S3 driver, which these unit tests cover,
// and the Durable Objects adapter, which runs in workerd (tests/integration/compat, test:storage)
// outside this report; its entry started at the coverage measured on 2026-11-23 with the first.
// scripts/coverage-thresholds.test.ts fails when a package has no src directory or no entry here.
export const thresholds = {
  "apps/api/src/**": { lines: 94, branches: 87 },
  "apps/web/src/**": { lines: 18.04, branches: 14.55 },
  "packages/auth/src/**": { lines: 100, branches: 100 },
  "packages/core/src/**": { lines: 100, branches: 98, functions: 100 },
  "packages/database/src/**": { lines: 93, branches: 95 },
  "packages/laws/src/**": { lines: 100, branches: 97 },
  "packages/migrate/src/**": { lines: 100, branches: 89 },
  // r2.ts and durable-object.ts run only in workerd (test:storage), outside this report.
  "packages/storage/src/**": { lines: 58.5, branches: 61 },
  "packages/ui/src/**": { lines: 34.37, branches: 100 },
  "packages/webdav/src/**": { lines: 97, branches: 88.9, functions: 96 },
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

import { resolve } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(
  resolve(import.meta.dirname, "../../../packages/database/drizzle"),
);

// upgrade/d1.test.ts upgrades one empty database from each older migration set, and compares
// them with one that a new install migrates: UPGRADE_from_1 ends at the first migration.
const upgradeDatabases = [
  "UPGRADE_fresh",
  ...migrations.slice(0, -1).map((_, index) => `UPGRADE_from_${index + 1}`),
];

// Runs inside workerd with a real D1 binding, because the code under test talks to D1 directly.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-11-04",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB", ...upgradeDatabases],
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: { include: ["identity/d1.test.ts", "upgrade/d1.test.ts"] },
});

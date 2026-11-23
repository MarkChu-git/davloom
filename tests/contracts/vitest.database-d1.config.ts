import { resolve } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(
  resolve(import.meta.dirname, "../../packages/database/drizzle"),
);

// The database contract suite on D1, inside workerd with the compatibility date of the Worker in
// apps/api/wrangler.jsonc and no flags. The global setup reads the schema of Bun SQLite in this
// process, which runs on Bun, for the test that compares it with D1's.
export default defineConfig({
  plugins: [
    cloudflareTest(({ inject }) => ({
      miniflare: {
        compatibilityDate: "2026-11-04",
        d1Databases: ["DB"],
        bindings: { TEST_MIGRATIONS: migrations, BUN_SQLITE_SCHEMA: inject("bunSqliteSchema") },
      },
    })),
  ],
  test: {
    include: ["database/d1.test.ts"],
    globalSetup: ["database/bun-sqlite-schema.setup.ts"],
  },
});

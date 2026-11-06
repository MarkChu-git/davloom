import { resolve } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(
  resolve(import.meta.dirname, "../../../packages/database/drizzle"),
);

// Runs inside workerd with a real D1 binding, because the code under test talks to D1 directly.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-11-04",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: { include: ["identity/d1.test.ts"] },
});

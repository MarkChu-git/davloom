import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Runs the storage contract against the Durable Objects adapter inside workerd.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "../../../packages/storage/test/worker.ts",
      miniflare: {
        compatibilityDate: "2026-11-04",
        durableObjects: {
          STORAGE: { className: "StorageObject", useSQLite: true },
          FULL: { className: "FullStorageObject", useSQLite: true },
        },
      },
    }),
  ],
  test: { include: ["../../../packages/storage/test/**/*.test.ts"], testTimeout: 60_000 },
});

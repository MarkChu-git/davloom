import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Runs the unit tests of packages/core inside workerd, with the compatibility date of the Worker
// in apps/api/wrangler.jsonc, so the code that both runtimes share is tested on Cloudflare's Web
// Crypto and platform as well as on Bun, where the root configuration runs the same tests.
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: "2026-11-04" } })],
  test: { include: ["../../../packages/core/src/**/*.test.ts"] },
});

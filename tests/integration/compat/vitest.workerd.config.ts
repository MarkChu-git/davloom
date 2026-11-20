import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Runs the unit tests of packages/core inside workerd, so the code that both runtimes share is
// tested on Cloudflare's Web Crypto and platform as well as on Bun, where the root configuration
// runs the same tests. The date repeats the Worker's in apps/api/wrangler.jsonc, as the D1
// configuration's does; the plugin adds the flags its own runner needs.
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: "2026-11-04" } })],
  test: { include: ["../../../packages/core/src/**/*.test.ts"] },
});

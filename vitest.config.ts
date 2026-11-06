import { defineConfig } from "vitest/config";

// Unit tests only. Runtime compatibility tests have their own configs in tests/integration/compat.
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts", "packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
  },
});

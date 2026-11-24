import { defineConfig } from "vitest/config";

// The Cloud Free quota check: the production Worker in local workerd with metered bindings.
export default defineConfig({
  test: {
    include: ["quota/**/*.test.ts"],
    pool: "forks",
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});

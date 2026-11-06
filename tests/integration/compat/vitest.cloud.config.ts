import { defineConfig } from "vitest/config";

// Measures a real deployment, or local workerd with DAVLOOM_PROBE_LOCAL set. Runs on Node for the
// same reason as the HTTP tests.
export default defineConfig({
  test: {
    include: ["cloud/**/*.test.ts"],
    pool: "forks",
    fileParallelism: false,
    hookTimeout: 120_000,
    // A slow uplink can take minutes over 95 MB, and the CPU ramp spends minutes on purpose.
    testTimeout: 1_200_000,
  },
});

import { defineConfig } from "vitest/config";

// Talks HTTP to real servers: a Bun process, and local workerd that Miniflare starts in the test process.
export default defineConfig({
  test: {
    include: ["http/**/*.test.ts"],
    pool: "forks",
    // One file at a time, so the streaming and memory limits are measured with one server running.
    fileParallelism: false,
    hookTimeout: 90_000,
    testTimeout: 30_000,
  },
});

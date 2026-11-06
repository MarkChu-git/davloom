import { defineConfig } from "vitest/config";

// Talks HTTP to real server processes: Bun, and workerd through wrangler dev. This has to run on
// Node: under `bun --bun`, child processes get Bun as `node`, and wrangler dev cannot forward requests.
export default defineConfig({
  test: {
    include: ["http/**/*.test.ts"],
    pool: "forks",
    // Concurrent wrangler dev sessions share a build directory and can break each other.
    fileParallelism: false,
    hookTimeout: 90_000,
    testTimeout: 30_000,
  },
});

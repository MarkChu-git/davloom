import { defineConfig } from "vitest/config";

// Has to run with `bun --bun`, because bun:sqlite only exists on Bun.
export default defineConfig({
  test: {
    include: ["identity/bun-sqlite.test.ts"],
    pool: "forks",
  },
});

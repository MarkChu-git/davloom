import { defineConfig } from "vitest/config";

// The database contract suite on Bun SQLite. It has to run with `bun --bun`, because bun:sqlite
// only exists on Bun.
export default defineConfig({
  test: {
    include: ["database/bun-sqlite.test.ts"],
    pool: "forks",
  },
});

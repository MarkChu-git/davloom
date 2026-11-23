import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// This package's unit tests alone, for Stryker (Decision 15 of add-phase-1-core): the root
// vitest.config.ts lists its tests from the repository root, where Stryker's runner finds none.
export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["src/**/*.test.ts"],
  },
});

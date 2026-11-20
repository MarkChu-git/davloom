import { defineConfig } from "vitest/config";

// A suite for the requirement coverage tests. Its files end in .spec.ts, which the unit tests do not
// run.
export default defineConfig({ test: { include: ["*.spec.ts"] } });

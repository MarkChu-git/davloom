import { defineConfig } from "vitest/config";

// The S3 driver against real RustFS in Docker, on Bun: `bun run --filter @davloom/storage test:s3`.
// The root unit run does not include these tests, since they need Docker.
export default defineConfig({
  test: {
    include: ["s3/**/*.test.ts"],
    globalSetup: ["s3/rustfs-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

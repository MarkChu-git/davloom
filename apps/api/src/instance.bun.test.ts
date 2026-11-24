import { Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { bunInstance, defaultS3Backend, ensureDefaultBucket } from "./instance.bun";

describe("defaultS3Backend", () => {
  it("is null without an endpoint", () => {
    expect(defaultS3Backend({})).toBeNull();
  });

  it("reads the DAVLOOM_S3_* variables, with defaults", () => {
    const backend = defaultS3Backend({
      DAVLOOM_S3_ENDPOINT: "http://rustfs:9000",
      DAVLOOM_S3_ACCESS_KEY_ID: "access",
      DAVLOOM_S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(backend?.config).toEqual({
      endpoint: "http://rustfs:9000",
      region: "us-east-1",
      bucket: "davloom",
      prefix: "",
      forcePathStyle: true,
      accessKeyId: "access",
    });
    expect(backend?.secretKey && Redacted.value(backend.secretKey)).toBe("secret");
  });

  it.each([
    ["false", false],
    ["true", true],
    [undefined, true],
  ])("DAVLOOM_S3_FORCE_PATH_STYLE=%s gives %s", (value, expected) => {
    const backend = defaultS3Backend({
      DAVLOOM_S3_ENDPOINT: "http://x",
      DAVLOOM_S3_FORCE_PATH_STYLE: value,
    });
    expect(backend?.config.forcePathStyle).toBe(expected);
    expect(backend?.secretKey).toBeNull();
  });
});

const tmp = () => mkdtempSync(join(tmpdir(), "davloom-bun-"));

describe("bunInstance", () => {
  it("refuses an instance secret shorter than 32 bytes", () => {
    expect(() => bunInstance({ DAVLOOM_SECRET: "short" })("http://x")).toThrow(
      "DAVLOOM_SECRET must be set to at least 32 bytes",
    );
    expect(() => bunInstance({})("http://x")).toThrow("DAVLOOM_SECRET");
  });

  it("creates its database in the data directory, with setup open for the token", async () => {
    const dir = tmp();
    try {
      const app = createApp({
        instance: bunInstance({
          DAVLOOM_SECRET: "s".repeat(32),
          DAVLOOM_SETUP_TOKEN: "  token  ",
          DAVLOOM_DATA_DIR: join(dir, "data"),
        }),
      });
      const status = await app.handle(new Request("https://davloom.test/api/setup"));
      expect(await status.json()).toEqual({ needed: true, open: true });
      expect(existsSync(join(dir, "data", "davloom.sqlite"))).toBe(true);
      const setup = await app.handle(
        new Request("https://davloom.test/api/setup", {
          method: "POST",
          body: JSON.stringify({
            name: "A",
            email: "a@b.test",
            password: "a long password",
            token: "token",
          }),
        }),
      );
      expect(setup.status).toBe(201);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names where it runs and counts operations", async () => {
    const dir = tmp();
    try {
      const instance = bunInstance({
        DAVLOOM_SECRET: "s".repeat(32),
        DAVLOOM_DATA_DIR: join(dir, "data"),
      })("http://x");
      const about = instance.about?.(new Request("http://x/"));
      expect(about).toMatchObject({ runtime: `Bun ${Bun.version}`, deployment: "Self-hosted" });
      expect(about?.database).toMatch(/^SQLite \d+\.\d+/);
      expect(typeof about?.region).toBe("string");
      expect(instance.operations).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps setup closed when the token is blank", async () => {
    const dir = tmp();
    try {
      const app = createApp({
        instance: bunInstance({
          DAVLOOM_SECRET: "s".repeat(32),
          DAVLOOM_SETUP_TOKEN: " ",
          DAVLOOM_DATA_DIR: dir,
        }),
      });
      expect(
        await (await app.handle(new Request("https://davloom.test/api/setup"))).json(),
      ).toEqual({
        needed: true,
        open: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ensureDefaultBucket", () => {
  it("does nothing without S3 settings or a secret key", async () => {
    await ensureDefaultBucket({});
    await ensureDefaultBucket({ DAVLOOM_S3_ENDPOINT: "http://127.0.0.1:1" });
  });

  it("reports a store it cannot reach, and goes on", async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      await ensureDefaultBucket({
        DAVLOOM_S3_ENDPOINT: "http://127.0.0.1:1",
        DAVLOOM_S3_ACCESS_KEY_ID: "a",
        DAVLOOM_S3_SECRET_ACCESS_KEY: "b",
      });
    } finally {
      console.error = original;
    }
    expect(String(errors[0])).toContain("could not create the bucket davloom");
  });
});

import { Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { defaultS3Backend } from "./instance.bun";

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

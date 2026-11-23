import { describe, expect, it } from "vitest";
import { checkS3Config } from "./backend-config";

const VALID = {
  endpoint: "https://s3.example.com",
  region: "eu-central-1",
  bucket: "davloom-files",
  prefix: "",
  accessKeyId: "AKIAEXAMPLE",
};

const fieldOf = (overrides: Record<string, unknown>) => {
  const result = checkS3Config({ ...VALID, ...overrides });
  return result.ok ? null : result.field;
};

describe("checkS3Config", () => {
  // Amazon S3's bucket naming rules: 3 to 63 characters of lowercase letters, digits, dots and
  // hyphens, beginning and ending with a letter or digit.
  it.each(["abc", "a.b", "a-b", "0-0", "my.bucket-1", "a".repeat(63)])(
    "accepts the bucket name %j",
    (bucket) => {
      expect(fieldOf({ bucket })).toBeNull();
    },
  );

  it.each([
    "ab",
    "a".repeat(64),
    "-abc",
    "abc-",
    ".abc",
    "abc.",
    "Abc",
    "a_b",
    "a b",
    "abc/",
    "abc/../x",
    "x/abc",
    "",
  ])("refuses the bucket name %j", (bucket) => {
    expect(fieldOf({ bucket })).toBe("bucket");
  });

  it.each([
    ["us-east-1", null],
    ["auto", null],
    ["a".repeat(64), null],
    ["a".repeat(65), "region"],
    ["EU", "region"],
    ["eu central", "region"],
    ["eu/1", "region"],
    ["/eu", "region"],
  ])("region %j gives %j", (region, field) => {
    expect(fieldOf({ region })).toBe(field);
  });

  it("defaults an empty region to us-east-1 and trims the fields", () => {
    const result = checkS3Config({
      ...VALID,
      region: "  ",
      bucket: " davloom-files ",
      accessKeyId: " AKIAEXAMPLE ",
    });
    expect(result).toEqual({
      ok: true,
      config: {
        endpoint: "https://s3.example.com",
        region: "us-east-1",
        bucket: "davloom-files",
        prefix: "",
        forcePathStyle: true,
        accessKeyId: "AKIAEXAMPLE",
      },
    });
  });

  it.each([
    ["", ""],
    ["files", "files/"],
    ["files/", "files/"],
    ["a/b", "a/b/"],
    ["x".repeat(99), `${"x".repeat(99)}/`],
  ])("prefix %j is stored as %j", (prefix, stored) => {
    const result = checkS3Config({ ...VALID, prefix });
    expect(result.ok && result.config.prefix).toBe(stored);
  });

  it.each(["/files", "a//b", "x".repeat(100)])("refuses the prefix %j", (prefix) => {
    expect(fieldOf({ prefix })).toBe("prefix");
  });

  it.each([
    ["a".repeat(256), null],
    ["a".repeat(257), "accessKeyId"],
    ["", "accessKeyId"],
    [42, "accessKeyId"],
  ])("access key id of %j gives %j", (accessKeyId, field) => {
    expect(fieldOf({ accessKeyId })).toBe(field);
  });

  it.each([null, "config", 42])("names the endpoint first when the configuration is %j", (raw) => {
    expect(checkS3Config(raw)).toEqual({ ok: false, field: "endpoint" });
  });
});

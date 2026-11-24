import { S3ServiceException } from "@aws-sdk/client-s3";
import { createMemoryPropertyStore, type BackendRecord } from "@davloom/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openS3Backend } from "./open-s3";
import { describeS3Error } from "./s3";

// The connection check of an S3-compatible backend, through a stubbed fetch, and the removal of
// what Davloom keeps for it.

const exception = (name: string, status?: number) =>
  new S3ServiceException({
    name,
    $fault: "client",
    $metadata: status === undefined ? {} : { httpStatusCode: status },
  });

describe("describeS3Error", () => {
  it.each([
    [exception("NoSuchBucket", 404), "The bucket does not exist"],
    [exception("InvalidAccessKeyId", 403), "The access key is not known"],
    [exception("SignatureDoesNotMatch", 403), "The secret key does not match the access key"],
    [exception("AccessDenied", 403), "The access key may not list the bucket"],
    [exception("PermanentRedirect", 301), "The bucket is in another region"],
    [exception("RequestTimeTooSkewed", 403), "The clocks of Davloom and the store differ"],
    [exception("Unknown", 404), "The bucket does not exist"],
    [exception("Unknown", 403), "The access key may not list the bucket"],
    [exception("SlowDown", 503), "SlowDown (503)"],
    [exception("Odd"), "Odd"],
    [new TypeError("fetch failed"), "No answer from the endpoint: fetch failed"],
    ["text", "No answer from the endpoint: text"],
  ])("describes %s as %s", (error, reason) => {
    expect(describeS3Error(error)).toBe(reason);
  });
});

const record = (overrides: Partial<BackendRecord> = {}): BackendRecord => ({
  id: "b-1",
  name: "Bucket",
  kind: "s3",
  config: {
    endpoint: "http://s3.test",
    region: "us-east-1",
    bucket: "davloom",
    prefix: "p/",
    forcePathStyle: true,
    accessKeyId: "access",
  },
  secretKey: "sealed",
  createdAt: new Date(0),
  ...overrides,
});

const secret = () => Promise.resolve("secret");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openS3Backend check", () => {
  it("lists one key under the prefix and answers ok", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", (input: Request) => {
      urls.push(new URL(input.url));
      return Promise.resolve(
        new Response("<ListBucketResult><Name>davloom</Name></ListBucketResult>", {
          headers: { "content-type": "application/xml" },
        }),
      );
    });
    const backend = openS3Backend(record(), secret, createMemoryPropertyStore());
    expect(await backend.check?.()).toEqual({ ok: true });
    expect(urls[0]?.pathname).toMatch(/^\/davloom\/?$/);
    expect(urls[0]?.searchParams.get("prefix")).toBe("p/");
    expect(urls[0]?.searchParams.get("max-keys")).toBe("1");
  });

  it("names the store's reason for refusing", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          "<Error><Code>NoSuchBucket</Code><Message>The bucket does not exist</Message></Error>",
          { status: 404, headers: { "content-type": "application/xml" } },
        ),
      ),
    );
    const backend = openS3Backend(record(), secret, createMemoryPropertyStore());
    expect(await backend.check?.()).toEqual({ ok: false, reason: "The bucket does not exist" });
  });

  it.each([
    [
      "an invalid configuration",
      record({ config: { endpoint: "nope" } }),
      secret,
      "The endpoint is not valid",
    ],
    ["no secret key", record({ secretKey: null }), secret, "No secret key is stored"],
    [
      "a secret that does not open",
      record(),
      () => Promise.resolve(null),
      "The stored secret key does not open",
    ],
  ])("names %s", async (_, stored, unseal, reason) => {
    const backend = openS3Backend(stored, unseal, createMemoryPropertyStore());
    expect(await backend.check?.()).toEqual({ ok: false, reason });
  });

  it("drops the dead properties it kept on release, without asking the store", async () => {
    const properties = createMemoryPropertyStore();
    await properties.patch(["a"], [{ name: "{x:}y", xml: "<y/>" }], []);
    const backend = openS3Backend(record({ secretKey: null }), secret, properties);
    expect(await backend.release?.()).toEqual({ ok: true, value: null });
    expect(await properties.get([["a"]])).toEqual({ ok: true, value: { a: [] } });
  });
});

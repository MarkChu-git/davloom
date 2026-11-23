import { createMemoryPropertyStore, CredentialsError, type BackendRecord } from "@davloom/core";
import { Effect, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { openS3Backend, unsealWith } from "./open-s3";

const record = (overrides: Partial<BackendRecord> = {}): BackendRecord => ({
  id: "b-1",
  name: "Bucket",
  kind: "s3",
  config: {
    endpoint: "http://127.0.0.1:1",
    region: "us-east-1",
    bucket: "davloom",
    prefix: "",
    forcePathStyle: true,
    accessKeyId: "access",
  },
  secretKey: "sealed",
  createdAt: new Date(0),
  ...overrides,
});

const unavailable = { ok: false, failure: "unavailable" };

describe("openS3Backend", () => {
  it.each([
    [
      "an invalid configuration",
      record({ config: { endpoint: "nope" } }),
      () => Promise.resolve("secret"),
    ],
    ["no sealed secret key", record({ secretKey: null }), () => Promise.resolve("secret")],
    ["a secret key that does not open", record(), () => Promise.resolve(null)],
  ])("answers unavailable with %s", async (_, stored, unseal) => {
    const backend = openS3Backend(stored, unseal, createMemoryPropertyStore());
    expect(await backend.stat([])).toEqual(unavailable);
    expect(await backend.list([])).toEqual(unavailable);
    expect(await backend.usage()).toEqual(unavailable);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel: () => void (cancelled = true) });
    expect(await backend.write(["f"], body, {})).toEqual(unavailable);
    expect(cancelled).toBe(true);
  });

  it("unseals the secret key once, on the first call", async () => {
    let unsealed = 0;
    const backend = openS3Backend(
      record({ config: { endpoint: "nope" } }),
      () => {
        unsealed += 1;
        return Promise.resolve("secret");
      },
      createMemoryPropertyStore(),
    );
    expect(unsealed).toBe(0);
    await backend.stat([]);
    await backend.list([]);
    expect(unsealed).toBe(0);
    const valid = openS3Backend(
      record(),
      () => {
        unsealed += 1;
        return Promise.resolve(null);
      },
      createMemoryPropertyStore(),
    );
    await valid.stat([]);
    await valid.read(["f"]);
    expect(unsealed).toBe(1);
  });
});

describe("unsealWith", () => {
  it("gives the secret, or null when the cipher refuses", async () => {
    const cipher = {
      open: (_id: string, sealed: string) =>
        sealed === "good"
          ? Effect.succeed(Redacted.make("secret"))
          : Effect.fail(new CredentialsError({ backendId: "b", message: "refused" })),
    };
    expect(await unsealWith(cipher)("b", "good")).toBe("secret");
    expect(await unsealWith(cipher)("b", "bad")).toBeNull();
  });
});

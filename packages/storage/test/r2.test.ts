import { env } from "cloudflare:workers";
import { createMemoryPropertyStore } from "@davloom/core";
import { storageContract } from "@davloom/core/testing";
import { describe, expect, it } from "vitest";
import { createObjectStoreStorage } from "../src/object-store";
import { createR2Driver, CREATED_METADATA } from "../src/r2";
import { CREATED_METADATA as S3_CREATED } from "../src/s3";

declare global {
  namespace Cloudflare {
    interface Env {
      readonly R2: R2Bucket;
    }
  }
}

// The R2 driver against Miniflare's R2 in workerd. Each backend takes a prefix of its own in the one
// bucket, as backends sharing a bucket do.
const fresh = () =>
  createObjectStoreStorage({
    driver: createR2Driver({ bucket: env.R2, partSize: 5 * 1024 * 1024 }),
    prefix: `${crypto.randomUUID()}/`,
    properties: createMemoryPropertyStore(),
  });

storageContract("R2", { make: fresh, runs: 25 });

const bytes = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 7) % 256);
const streamOf = (data: Uint8Array<ArrayBuffer>) => new Blob([data]).stream();

describe("R2 driver", () => {
  it("keeps the creation time under the same name as the S3 driver", () => {
    expect(CREATED_METADATA).toBe(S3_CREATED);
  });

  it.each([0, 1, 5 * 1024 * 1024 + 3, 11 * 1024 * 1024])(
    "uploads %i bytes of unknown length in parts and reads them back",
    async (length) => {
      const storage = fresh();
      const data = bytes(length);
      expect((await storage.write(["f"], streamOf(data), {})).ok).toBe(true);
      const read = await storage.read(["f"]);
      expect(read.ok && new Uint8Array(await new Response(read.value.body).arrayBuffer())).toEqual(
        data,
      );
    },
  );

  it("reads a range", async () => {
    const storage = fresh();
    await storage.write(["f"], streamOf(bytes(100)), { size: 100 });
    const read = await storage.read(["f"], { start: 10, stop: 20 });
    expect(read.ok && new Uint8Array(await new Response(read.value.body).arrayBuffer())).toEqual(
      bytes(100).slice(10, 20),
    );
  });

  it("refuses a create-only write over an object, with a known and an unknown length", async () => {
    const driver = createR2Driver({ bucket: env.R2 });
    const key = `${crypto.randomUUID()}/f`;
    expect((await driver.put(key, null, { created: 1, ifNoneMatch: true })).ok).toBe(true);
    expect(await driver.put(key, null, { created: 1, ifNoneMatch: true })).toEqual({
      ok: false,
      failure: "exists",
    });
    expect(await driver.put(key, streamOf(bytes(3)), { created: 1, ifNoneMatch: true })).toEqual({
      ok: false,
      failure: "exists",
    });
  });

  it("copies an object with its metadata, and reports a missing source", async () => {
    const driver = createR2Driver({ bucket: env.R2 });
    const prefix = `${crypto.randomUUID()}/`;
    await driver.put(`${prefix}a`, streamOf(bytes(5)), {
      length: 5,
      created: 42,
      contentType: "text/plain",
    });
    expect(await driver.copy(`${prefix}a`, `${prefix}b`)).toEqual({ ok: true, value: true });
    const head = await driver.head(`${prefix}b`);
    expect(head.ok && head.value).toMatchObject({
      size: 5,
      created: 42,
      contentType: "text/plain",
    });
    expect(await driver.copy(`${prefix}missing`, `${prefix}c`)).toEqual({ ok: true, value: false });
  });

  it("answers unavailable when the binding fails", async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a bucket whose one used call fails
    const broken = { head: () => Promise.reject(new Error("down")) } as unknown as R2Bucket;
    expect(await createR2Driver({ bucket: broken }).head("x")).toEqual({
      ok: false,
      failure: "unavailable",
    });
  });
});

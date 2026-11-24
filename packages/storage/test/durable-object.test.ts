import { env } from "cloudflare:workers";
import { storageContract } from "@davloom/core/testing";
import { describe, expect, it } from "vitest";
import { CHUNK_BYTES, durableObjectStorage, type StorageObject } from "../src/durable-object";
import type { FullStorageObject } from "./worker";

declare global {
  namespace Cloudflare {
    interface Env {
      readonly STORAGE: DurableObjectNamespace<StorageObject>;
      readonly FULL: DurableObjectNamespace<FullStorageObject>;
    }
  }
}

const fresh = () => durableObjectStorage(env.STORAGE, crypto.randomUUID());

storageContract("Durable Objects", { make: fresh, runs: 40 });

const bytes = (length: number, seed = 1) =>
  Uint8Array.from({ length }, (_, i) => (i * 31 + seed) % 251);
const streamOf = (data: Uint8Array<ArrayBuffer>) => new Blob([data]).stream();
const read = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer());

describe("Durable Objects adapter", () => {
  it.each([0, 1, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, 3 * CHUNK_BYTES + 17])(
    "stores %i bytes in chunks and reads them back",
    async (length) => {
      const storage = fresh();
      const data = bytes(length);
      const written = await storage.write(["f"], streamOf(data), { size: length });
      expect(written.ok).toBe(true);
      const result = await storage.read(["f"]);
      expect(result.ok && (await read(result.value.body))).toEqual(data);
    },
  );

  it.each([
    [0, 10],
    [CHUNK_BYTES - 5, CHUNK_BYTES + 5],
    [CHUNK_BYTES, 2 * CHUNK_BYTES],
    [2 * CHUNK_BYTES + 3, 2 * CHUNK_BYTES + 4],
  ])("reads the range %i to %i across chunks", async (start, stop) => {
    const storage = fresh();
    const data = bytes(3 * CHUNK_BYTES);
    await storage.write(["f"], streamOf(data), {});
    const result = await storage.read(["f"], { start, stop });
    expect(result.ok && (await read(result.value.body))).toEqual(data.slice(start, stop));
  });

  it("moving a collection keeps the content of everything under it", async () => {
    const storage = fresh();
    await storage.createCollection(["d"]);
    await storage.createCollection(["d", "e"]);
    await storage.write(["d", "e", "f"], streamOf(bytes(CHUNK_BYTES + 3)), {});
    expect((await storage.move(["d"], ["m"], { overwrite: false })).ok).toBe(true);
    const result = await storage.read(["m", "e", "f"]);
    expect(result.ok && (await read(result.value.body)).length).toBe(CHUNK_BYTES + 3);
  });

  it("a full object refuses writes and still reads, lists and removes", async () => {
    const id = env.FULL.idFromName(crypto.randomUUID());
    const full = durableObjectStorage(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a namespace that always reaches one object
      {
        get: () => env.FULL.get(id),
        idFromName: () => id,
      } as unknown as DurableObjectNamespace<StorageObject>,
      "full",
    );
    expect((await full.write(["f"], streamOf(bytes(10)), {})).ok).toBe(true);
    await env.FULL.get(id).setFull(true);
    expect(await full.write(["g"], streamOf(bytes(10)), {})).toEqual({
      ok: false,
      failure: "insufficient-storage",
    });
    expect(await full.createCollection(["d"])).toEqual({
      ok: false,
      failure: "insufficient-storage",
    });
    expect(await full.copy(["f"], ["h"], { overwrite: false, shallow: false })).toEqual({
      ok: false,
      failure: "insufficient-storage",
    });
    expect((await full.list([])).ok).toBe(true);
    expect((await full.read(["f"])).ok).toBe(true);
    expect((await full.remove(["f"])).ok).toBe(true);
  });

  it("reports its quota against the 1 GB object limit", async () => {
    const storage = fresh();
    await storage.write(["f"], streamOf(bytes(1000)), {});
    const quota = await storage.quota?.([]);
    expect(quota?.ok && quota.value.used).toBe(1000);
    expect(quota?.ok && quota.value.available).toBeGreaterThan(900_000_000);
    expect(quota?.ok && quota.value.available).toBeLessThan(1_000_000_000);
  });

  it("destroys only an empty object", async () => {
    const name = crypto.randomUUID();
    const stub = env.STORAGE.get(env.STORAGE.idFromName(name));
    const storage = durableObjectStorage(env.STORAGE, name);
    await storage.write(["f"], null, {});
    expect(await stub.destroyIfEmpty()).toEqual({ ok: false, failure: "exists" });
    await storage.remove(["f"]);
    expect(await stub.destroyIfEmpty()).toEqual({ ok: true, value: null });
  });

  it("answers unavailable when the object cannot be reached", async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a namespace whose stubs cannot be made
    const broken = {
      get: () => {
        throw new Error("down");
      },
      idFromName: () => ({}),
    } as unknown as DurableObjectNamespace<StorageObject>;
    expect(await durableObjectStorage(broken, "x").stat([])).toEqual({
      ok: false,
      failure: "unavailable",
    });
  });
});

/** A collection `src` holding `files` empty files, so a copy writes files + 1 entries. */
const tree = async (files: number) => {
  const storage = fresh();
  await storage.createCollection(["src"]);
  await Promise.all(
    Array.from({ length: files }, (_, i) =>
      storage.write(["src", `f${i}`], new Blob([]).stream(), { size: 0 }),
    ),
  );
  return storage;
};

describe("the synchronous limit of the Durable Objects adapter", () => {
  it("copies a tree of exactly 1,000 entries", { timeout: 60_000 }, async () => {
    const storage = await tree(999);
    expect((await storage.copy(["src"], ["dst"], { overwrite: false, shallow: false })).ok).toBe(
      true,
    );
  });

  it(
    "refuses to copy a tree of 1,001 entries, and changes nothing",
    { timeout: 60_000 },
    async () => {
      const storage = await tree(1000);
      expect(await storage.copy(["src"], ["dst"], { overwrite: false, shallow: false })).toEqual({
        ok: false,
        failure: "too-many",
      });
      expect(await storage.stat(["dst"])).toEqual({ ok: false, failure: "not-found" });
      // A move only renames, so it has no limit; a shallow copy writes one entry.
      expect((await storage.copy(["src"], ["one"], { overwrite: false, shallow: true })).ok).toBe(
        true,
      );
      expect((await storage.move(["src"], ["moved"], { overwrite: false })).ok).toBe(true);
    },
  );
});

import { createMemoryPropertyStore } from "@davloom/core";
import { snapshot } from "@davloom/core/testing";
import { describe, expect, it, vi } from "vitest";
import { createMemoryR2, LocalFixedLengthStream } from "../test/memory-r2";
import { r2Suite } from "../test/r2-suite";
import { createObjectStoreStorage } from "./object-store";
import { createR2Driver, CREATED_METADATA, R2_PART_BYTES } from "./r2";

// The R2 driver on Bun, against a bucket in memory, with the cases it passes against Miniflare's R2
// in workerd (test/r2.test.ts). Bun has no FixedLengthStream, so the stand-in takes its place.
if (!("FixedLengthStream" in globalThis)) {
  Object.defineProperty(globalThis, "FixedLengthStream", { value: LocalFixedLengthStream });
}

r2Suite("Bun", createMemoryR2().bucket, 60);

const bytes = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 13) % 256);
const streamOf = (data: Uint8Array<ArrayBuffer>) => new Blob([data]).stream();

describe("R2 driver on a bucket in memory", () => {
  it("parts of 8 MiB are the default, above R2's 5 MiB minimum", () => {
    expect(R2_PART_BYTES).toBe(8 * 1024 * 1024);
    expect(R2_PART_BYTES).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });

  it.each([
    [0, 4, 1],
    [3, 4, 1],
    [4, 4, 1],
    [5, 4, 2],
    [12, 4, 3],
    [13, 5, 3],
  ])("uploads %i bytes of unknown length in parts of %i: %i parts", async (length, size, parts) => {
    const memory = createMemoryR2();
    const sizes: number[] = [];
    const create = memory.bucket.createMultipartUpload.bind(memory.bucket);
    vi.spyOn(memory.bucket, "createMultipartUpload").mockImplementation(async (key, options) => {
      const upload = await create(key, options);
      const uploadPart = upload.uploadPart.bind(upload);
      vi.spyOn(upload, "uploadPart").mockImplementation((number, value) => {
        sizes.push(value instanceof Uint8Array ? value.length : -1);
        return uploadPart(number, value);
      });
      return upload;
    });
    const driver = createR2Driver({ bucket: memory.bucket, partSize: size });
    const data = bytes(length);
    expect((await driver.put("k", streamOf(data), { created: 7 })).ok).toBe(true);
    expect(memory.objects.get("k")?.bytes).toEqual(data);
    expect(memory.openUploads()).toBe(0);
    expect(sizes).toHaveLength(parts);
    // Every part but the last holds exactly the part size.
    expect(sizes.slice(0, -1).every((n) => n === size)).toBe(true);
    expect(sizes.reduce((sum, n) => sum + n, 0)).toBe(length);
  });

  it("aborts the upload when a part fails, and stores nothing", async () => {
    const memory = createMemoryR2();
    const create = memory.bucket.createMultipartUpload.bind(memory.bucket);
    vi.spyOn(memory.bucket, "createMultipartUpload").mockImplementation(async (key, options) => {
      const upload = await create(key, options);
      let calls = 0;
      vi.spyOn(upload, "uploadPart").mockImplementation(() => {
        calls += 1;
        return Promise.reject(new Error(`part ${calls} lost`));
      });
      return upload;
    });
    const driver = createR2Driver({ bucket: memory.bucket, partSize: 4 });
    expect(await driver.put("k", streamOf(bytes(9)), { created: 1 })).toEqual({
      ok: false,
      failure: "unavailable",
    });
    expect(memory.objects.has("k")).toBe(false);
    expect(memory.openUploads()).toBe(0);
  });

  it("writes a create-only body of unknown length onto a new key", async () => {
    const memory = createMemoryR2();
    const driver = createR2Driver({ bucket: memory.bucket });
    expect(
      (await driver.put("new", streamOf(bytes(3)), { created: 1, ifNoneMatch: true })).ok,
    ).toBe(true);
    expect(memory.objects.get("new")?.bytes).toEqual(bytes(3));
  });

  it("keeps the content type and the creation time, and reads them back", async () => {
    const memory = createMemoryR2();
    const driver = createR2Driver({ bucket: memory.bucket });
    await driver.put("k", streamOf(bytes(2)), {
      length: 2,
      created: 1234,
      contentType: "image/png",
    });
    expect(memory.objects.get("k")?.customMetadata).toEqual({ [CREATED_METADATA]: "1234" });
    const head = await driver.head("k");
    expect(head.ok && head.value).toMatchObject({
      key: "k",
      size: 2,
      created: 1234,
      contentType: "image/png",
    });
    expect(await driver.head("missing")).toEqual({ ok: true, value: null });
    expect(await driver.get("missing")).toEqual({ ok: true, value: null });
  });

  it.each([
    ["no creation time", undefined, undefined],
    ["a creation time that is no number", "soon", undefined],
    ["a creation time", "99", 99],
  ])("reads an object another tool wrote with %s", async (_, created, expected) => {
    const memory = createMemoryR2();
    await memory.bucket.put(
      "other",
      "x",
      created ? { customMetadata: { [CREATED_METADATA]: created } } : {},
    );
    const head = await createR2Driver({ bucket: memory.bucket }).head("other");
    expect(head.ok && head.value?.created).toBe(expected);
    expect(head.ok && head.value?.contentType).toBeNull();
  });

  it("lists in pages with the cursor R2 gives, and rolls keys up to their first slash", async () => {
    const memory = createMemoryR2(2);
    const driver = createR2Driver({ bucket: memory.bucket });
    for (const key of ["p/a", "p/b", "p/c/d", "p/e"]) await memory.bucket.put(key, "x");
    const first = await driver.list("p/", { recursive: false, cursor: null, limit: 2 });
    expect(first).toEqual({
      ok: true,
      value: {
        objects: [expect.objectContaining({ key: "p/a" }), expect.objectContaining({ key: "p/b" })],
        prefixes: [],
        cursor: "2",
      },
    });
    const second = await driver.list("p/", { recursive: false, cursor: "2", limit: 2 });
    expect(second.ok && second.value).toMatchObject({ prefixes: ["p/c/"], cursor: null });
    const all = await driver.list("p/", { recursive: true, cursor: null, limit: 10 });
    expect(all.ok && all.value.objects.map(({ key }) => key)).toEqual(["p/a", "p/b"]);
  });

  it("deletes keys in one call, and makes no call for none", async () => {
    const memory = createMemoryR2();
    const remove = vi.spyOn(memory.bucket, "delete");
    const driver = createR2Driver({ bucket: memory.bucket });
    await memory.bucket.put("a", "x");
    await memory.bucket.put("b", "x");
    expect(await driver.delete([])).toEqual({ ok: true, value: null });
    expect(remove).not.toHaveBeenCalled();
    expect(await driver.delete(["a", "b"])).toEqual({ ok: true, value: null });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(memory.objects.size).toBe(0);
  });

  it("turns a quoted or weak ETag into the bare value", async () => {
    const memory = createMemoryR2();
    const bucket = {
      ...memory.bucket,
      head: () =>
        Promise.resolve({
          key: "k",
          size: 0,
          etag: 'W/"abc"',
          uploaded: new Date(5),
          httpMetadata: {},
          customMetadata: {},
        }),
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a bucket whose head answers a weak ETag
    const head = await createR2Driver({ bucket: bucket as unknown as R2Bucket }).head("k");
    expect(head.ok && head.value).toMatchObject({ etag: "abc", modified: 5 });
  });

  it("backs a whole tree through the object-store adapter", async () => {
    const memory = createMemoryR2();
    const storage = createObjectStoreStorage({
      driver: createR2Driver({ bucket: memory.bucket }),
      prefix: "dav/",
      properties: createMemoryPropertyStore(),
    });
    await storage.createCollection(["d"]);
    await storage.write(["d", "f"], streamOf(bytes(3)), { size: 3 });
    expect((await storage.copy(["d"], ["e"], { overwrite: false, shallow: false })).ok).toBe(true);
    expect(Object.keys(await snapshot(storage))).toEqual(["d/", "d/f", "e/", "e/f"]);
  });
});

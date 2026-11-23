import {
  CreateBucketCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createMemoryPropertyStore, type Path, type StorageBackend } from "@davloom/core";
import { snapshot, storageContract } from "@davloom/core/testing";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { createObjectStoreStorage } from "../src/object-store";
import { createS3Client, createS3Driver } from "../src/s3";

// The object-store adapter with the S3 driver against RustFS 1.0.6 in Docker (rustfs-setup.ts).
// One bucket serves the file, and each backend takes a fresh key prefix, so every test starts
// from an empty tree; the tests without a prefix take a bucket of their own.
//
// Keys that RustFS refuses and AWS S3 accepts, found by putting them directly (each refused with
// 400 InvalidArgument). The scenarios that need them run on the memory driver in
// src/object-store.test.ts, which keeps any key as AWS S3 does:
// - a key with an empty part, such as `docs//b.txt` ("Invalid object key");
// - a key with a `.` or `..` part, such as `./d.txt`, `docs/../c.txt` or `dir/.` ("Invalid object
//   key");
// - a key with a control character, such as U+0001 ("Object key contains characters unsupported
//   by XML listings"), although listings ask for URL-encoded keys;
// - a part of more than 255 bytes, such as 256 ASCII letters or 86 CJK characters ("Invalid
//   argument"); the storage namespace's name rule refuses those names too.
// - the marker of a collection whose name takes more than 246 bytes, such as `<255 letters>/`,
//   although a file of that name and keys under it are kept: RustFS seems to keep a marker under
//   its name with a 9-byte suffix (MinIO's `__XLDIR__`), which then passes its 255-byte limit.
// RustFS does keep a file and a key under it at once (`photos` and `photos/a.jpg`), which stores
// built like MinIO refuse, so the shadowed-file scenarios run here as well.

const config = inject("rustfs");
const client: S3Client = createS3Client({ ...config, bucket: "" });
const BUCKET = `davloom-${crypto.randomUUID().slice(0, 8)}`;

const createBucket = async (bucket: string) => {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
};

const backend = (prefix = `t-${crypto.randomUUID()}/`, bucket = BUCKET) => ({
  prefix,
  storage: createObjectStoreStorage({
    driver: createS3Driver({ client, bucket }),
    prefix,
    properties: createMemoryPropertyStore(),
  }),
});

/** Puts an object as another tool would. */
const put = async (key: string, text = "x", bucket = BUCKET) => {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: text }));
};

const keysUnder = async (prefix: string, bucket = BUCKET) => {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    keys.push(...(page.Contents ?? []).map((object) => object.Key ?? ""));
    token = page.NextContinuationToken;
  } while (token);
  return keys.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
};

const text = (value: string) => new Blob([value]).stream();
const bytes = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 7) % 251);
const readAll = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer());
/** A body that sends 2 MiB and then fails, as a client that goes away. */
const failing = () => {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= 2) controller.error(new Error("the client went away"));
      else controller.enqueue(bytes(1024 * 1024));
      sent += 1;
    },
  });
};
const names = async (storage: StorageBackend, path: Path) => {
  const listed = await storage.list(path);
  return listed.ok ? listed.value.map((entry) => `${entry.path.at(-1) ?? ""}:${entry.kind}`) : [];
};

beforeAll(async () => {
  await createBucket(BUCKET);
});

storageContract("object store, S3 driver on RustFS", { make: () => backend().storage, runs: 40 });

storageContract("object store, S3 driver on RustFS, no prefix", {
  make: async () => {
    const bucket = `davloom-${crypto.randomUUID().slice(0, 8)}`;
    await createBucket(bucket);
    return backend("", bucket).storage;
  },
  runs: 10,
});

describe("S3 driver on RustFS", () => {
  it.each([
    ["CJK", "中文文件.txt"],
    ["emoji", "😀 smile.txt"],
    ["percent", "100% done.txt"],
    ["plus", "a+b=c.txt"],
    ["spaces", "  two  spaces  "],
    ["hash", "#1 issue.txt"],
    ["query and ampersand", "q?a=1&b=2"],
    ["XML characters", `<tag a="b">'&'<\\tag>`],
    ["backslash", "a\\b"],
    ["82 CJK characters", "中".repeat(82)],
  ])("keeps a name with %s through write, list, copy, move and read", async (_, name) => {
    const { storage, prefix } = backend();
    expect((await storage.createCollection([name])).ok).toBe(true);
    expect(
      (
        await storage.write([name, name], text(name), {
          size: new TextEncoder().encode(name).length,
        })
      ).ok,
    ).toBe(true);
    expect(await names(storage, [])).toEqual([`${name}:collection`]);
    expect(await names(storage, [name])).toEqual([`${name}:file`]);
    expect((await storage.copy([name], ["copy"], { overwrite: false, shallow: false })).ok).toBe(
      true,
    );
    expect((await storage.move([name, name], [name, "renamed"], { overwrite: false })).ok).toBe(
      true,
    );
    expect(await snapshot(storage)).toEqual({
      [`${name}/`]: "",
      [`${name}/renamed`]: name,
      "copy/": "",
      [`copy/${name}`]: name,
    });
    expect(await keysUnder(prefix)).toEqual(
      [
        `${prefix}${name}/`,
        `${prefix}${name}/renamed`,
        `${prefix}copy/`,
        `${prefix}copy/${name}`,
      ].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });

  it("keeps a file name of 255 bytes, though RustFS refuses a marker of more than 246", async () => {
    const { storage } = backend();
    const long = "中".repeat(85);
    expect((await storage.write([long], text("x"), { size: 1 })).ok).toBe(true);
    expect(await names(storage, [])).toEqual([`${long}:file`]);
    expect((await storage.createCollection(["中".repeat(82)])).ok).toBe(true);
    expect(await storage.createCollection([`${"中".repeat(82)}a`])).toEqual({
      ok: false,
      failure: "unavailable",
    });
  });

  it("gives S3's ETag without quotes and keeps it on a read", async () => {
    const { storage } = backend();
    const written = await storage.write(["f"], text("hello"), { size: 5 });
    expect(written.ok && written.value.entry.etag).toBe("5d41402abc4b2a76b9719d911017c592");
    const read = await storage.read(["f"]);
    expect(read.ok && read.value.entry.etag).toBe("5d41402abc4b2a76b9719d911017c592");
    const listed = await storage.list([]);
    expect(listed.ok && listed.value[0]?.etag).toBe("5d41402abc4b2a76b9719d911017c592");
  });

  it("keeps the content type and the creation time across a rewrite", async () => {
    const { storage } = backend();
    const first = await storage.write(["f"], text("a"), { size: 1, contentType: "text/plain" });
    await Bun.sleep(1100);
    const second = await storage.write(["f"], text("b"), { size: 1, contentType: "text/csv" });
    if (!first.ok || !second.ok) throw new Error("the writes failed");
    expect(second.value.entry.contentType).toBe("text/csv");
    expect(second.value.entry.created).toBe(first.value.entry.created);
    expect(second.value.entry.modified).toBeGreaterThan(first.value.entry.modified);
  });

  it("streams a large body of known length and reads it back by range", async () => {
    const { storage } = backend();
    const data = bytes(9 * 1024 * 1024 + 3);
    expect(
      (await storage.write(["big"], new Blob([data]).stream(), { size: data.length })).ok,
    ).toBe(true);
    const whole = await storage.read(["big"]);
    expect(whole.ok && (await readAll(whole.value.body))).toEqual(data);
    const part = await storage.read(["big"], { start: 5_000_000, stop: 5_000_010 });
    expect(part.ok && part.value.entry.size).toBe(data.length);
    expect(part.ok && (await readAll(part.value.body))).toEqual(data.slice(5_000_000, 5_000_010));
  });

  it("uploads a body of unknown length in parts", async () => {
    const driver = createS3Driver({ client, bucket: BUCKET, partSize: 5 * 1024 * 1024 });
    const storage = createObjectStoreStorage({
      driver,
      prefix: `t-${crypto.randomUUID()}/`,
      properties: createMemoryPropertyStore(),
    });
    const data = bytes(11 * 1024 * 1024);
    const written = await storage.write(["parts"], new Blob([data]).stream(), {});
    expect(written.ok && written.value.entry.size).toBe(data.length);
    // A multipart ETag ends with the number of parts.
    expect(written.ok && written.value.entry.etag).toMatch(/^[0-9a-f]{32}-3$/);
    const read = await storage.read(["parts"]);
    expect(read.ok && (await readAll(read.value.body))).toEqual(data);
    expect((await storage.write(["small"], text("tiny"), {})).ok).toBe(true);
    expect(await snapshot(storage, [])).toMatchObject({ small: "tiny" });
  });

  it("keeps the old object when a body fails part-way, stated size or not", async () => {
    const { storage } = backend();
    await storage.write(["f"], text("old"), { size: 3 });
    expect(await storage.write(["f"], failing(), { size: 5 * 1024 * 1024 })).toEqual({
      ok: false,
      failure: "size-mismatch",
    });
    expect(await storage.write(["f"], failing(), {})).toEqual({
      ok: false,
      failure: "size-mismatch",
    });
    expect(await snapshot(storage)).toEqual({ f: "old" });
  });

  it("shows the objects that other tools put in the bucket", async () => {
    const { storage, prefix } = backend();
    await put(`${prefix}photos/2026/a.jpg`);
    expect(await names(storage, [])).toEqual(["photos:collection"]);
    expect(await names(storage, ["photos", "2026"])).toEqual(["a.jpg:file"]);
    expect(await storage.remove(["photos", "2026", "a.jpg"])).toEqual({ ok: true, value: null });
    expect(await names(storage, ["photos", "2026"])).toEqual([]);
    expect(await names(storage, [])).toEqual(["photos:collection"]);
    expect(await keysUnder(prefix)).toEqual([`${prefix}photos/2026/`]);
  });

  it("keeps a collection without a marker when its last entry moves away", async () => {
    const { storage, prefix } = backend();
    await put(`${prefix}inbox/a.txt`);
    expect((await storage.move(["inbox", "a.txt"], ["a.txt"], { overwrite: false })).ok).toBe(true);
    expect(await snapshot(storage)).toEqual({ "inbox/": "", "a.txt": "x" });
  });

  it("hides a file behind a collection of its name and refuses to remove it", async () => {
    const { storage, prefix } = backend();
    await put(`${prefix}photos`, "file");
    await put(`${prefix}photos/a.jpg`);
    expect(await names(storage, [])).toEqual(["photos:collection"]);
    expect(await storage.read(["photos"])).toEqual({ ok: false, failure: "is-collection" });
    for (const result of [
      await storage.remove(["photos"]),
      await storage.copy(["photos"], ["copy"], { overwrite: false, shallow: false }),
      await storage.move(["photos"], ["moved"], { overwrite: false }),
    ]) {
      expect(result).toEqual({ ok: false, failure: "hidden-objects" });
    }
    expect(await keysUnder(prefix)).toEqual([`${prefix}photos`, `${prefix}photos/a.jpg`]);
  });

  it("never lists, changes or removes objects outside its prefix", async () => {
    const shared = `shared-${crypto.randomUUID()}/`;
    await put(`${shared}other/x.txt`);
    const { storage } = backend(`${shared}davloom/`);
    await storage.write(["a.txt"], text("a"), { size: 1 });
    expect(await names(storage, [])).toEqual(["a.txt:file"]);
    expect(await storage.remove(["a.txt"])).toEqual({ ok: true, value: null });
    expect(await keysUnder(shared)).toEqual([`${shared}other/x.txt`]);
  });

  it("lists collections with more members than one page holds", async () => {
    const { storage, prefix } = backend();
    await Promise.all(
      Array.from({ length: 1005 }, (_, index) =>
        put(`${prefix}many/f${String(index).padStart(4, "0")}`),
      ),
    );
    const listed = await storage.list(["many"]);
    expect(listed.ok && listed.value.length).toBe(1005);
    expect(await storage.usage()).toEqual({
      ok: true,
      value: { files: 1005, collections: 1, bytes: 1005 },
    });
    expect((await storage.move(["many"], ["moved"], { overwrite: false })).ok).toBe(true);
    expect(await keysUnder(`${prefix}many`)).toEqual([]);
    expect((await keysUnder(`${prefix}moved/`)).length).toBe(1006);
    expect(await storage.remove(["moved"])).toEqual({ ok: true, value: null });
    expect(await keysUnder(prefix)).toEqual([]);
  });

  it("reads an object written with a stored creation time back from the SDK", async () => {
    const { storage, prefix } = backend();
    const written = await storage.write(["f"], text("x"), { size: 1 });
    const found = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${prefix}f` }));
    expect(found.Metadata?.["davloom-created"]).toBe(
      String(written.ok && written.value.entry.created),
    );
  });

  it.each([
    ["a bucket that does not exist", { ...config, bucket: "davloom-missing" }],
    ["a wrong secret key", { ...config, secretAccessKey: "wrong", bucket: BUCKET }],
    [
      "an endpoint that does not answer",
      { ...config, endpoint: "http://127.0.0.1:9", bucket: BUCKET },
    ],
  ])("answers unavailable for %s", async (_, settings) => {
    const storage = createObjectStoreStorage({
      driver: createS3Driver({ client: createS3Client(settings), bucket: settings.bucket }),
      prefix: "",
      properties: createMemoryPropertyStore(),
    });
    expect(await storage.list([])).toEqual({ ok: false, failure: "unavailable" });
    expect(await storage.write(["f"], text("x"), { size: 1 })).toEqual({
      ok: false,
      failure: "unavailable",
    });
  });
});

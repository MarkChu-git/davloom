import {
  createMemoryPropertyStore,
  fail,
  type DeadProperty,
  type Path,
  type PropertyStore,
  type StorageBackend,
} from "@davloom/core";
import { snapshot, storageContract } from "@davloom/core/testing";
import * as fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLLECTION_ETAG,
  createObjectStoreStorage,
  fileKey,
  markerKey,
  MAX_UPLOAD_BYTES,
  pathOfKey,
  readLevel,
  readTree,
  type ObjectInfo,
  type ObjectStoreDriver,
} from "./object-store";
import { compareKeys, createMemoryDriver, type MemoryDriver } from "./testing/memory-driver";

// The object-store adapter on the memory driver, which keeps any key as AWS S3 does: the storage
// contract, the rules that turn keys into a tree, and the cases that need keys another tool wrote.

const make = (prefix = "dav/", pageSize = 1000, properties = createMemoryPropertyStore()) => {
  const driver = createMemoryDriver({ pageSize });
  return { driver, properties, storage: createObjectStoreStorage({ driver, prefix, properties }) };
};

storageContract("object store, memory driver", { make: () => make().storage, runs: 200 });
// Pages of two keys, so every listing takes several pages, and no prefix, so keys start at the
// bucket's root.
storageContract("object store, memory driver, pages of two keys, no prefix", {
  make: () => make("", 2).storage,
  runs: 100,
});

const text = (value: string) => new Blob([value]).stream();
const property = (local: string): DeadProperty => ({
  name: `{urn:t}${local}`,
  xml: `<${local} xmlns="urn:t"/>`,
});
const info = (key: string, size = 1): ObjectInfo => ({ key, size, etag: `t-${key}`, modified: 5 });
const failed = (failure: string) => ({ ok: false, failure });
const names = async (storage: StorageBackend, path: Path) => {
  const listed = await storage.list(path);
  if (!listed.ok) return listed.failure;
  return listed.value.map(
    (entry) => `${entry.path.at(-1) ?? ""}${entry.kind === "collection" ? "/" : ""}`,
  );
};
const seedAll = (driver: MemoryDriver, keys: readonly string[]) => {
  for (const key of keys) driver.seed(key, key);
};
const sortedKeys = (keys: readonly string[]) => keys.toSorted(compareKeys);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("keys", () => {
  it.each([
    ["", ["a"], "a", "a/"],
    ["", ["a", "b"], "a/b", "a/b/"],
    ["dav/", ["a"], "dav/a", "dav/a/"],
    ["dav/x/", ["中文", "😀 #%+"], "dav/x/中文/😀 #%+", "dav/x/中文/😀 #%+/"],
    ["dav/", [], "dav/", "dav/"],
    ["", [], "", ""],
  ] as [string, Path, string, string][])(
    "prefix %j and path %j: file %j, marker %j",
    (prefix, path, file, marker) => {
      expect(fileKey(prefix, path)).toBe(file);
      expect(markerKey(prefix, path)).toBe(marker);
    },
  );

  it.each([
    ["dav/a", { path: ["a"], kind: "file" }],
    ["dav/a/", { path: ["a"], kind: "collection" }],
    ["dav/a/b c/d", { path: ["a", "b c", "d"], kind: "file" }],
    ["dav/中文/😀.txt", { path: ["中文", "😀.txt"], kind: "file" }],
    ["dav/100%/a+b #1", { path: ["100%", "a+b #1"], kind: "file" }],
    ["dav/ ", { path: [" "], kind: "file" }],
    ["dav/.hidden", { path: [".hidden"], kind: "file" }],
    ["dav/...", { path: ["..."], kind: "file" }],
    [`dav/${"a".repeat(255)}`, { path: ["a".repeat(255)], kind: "file" }],
    // Outside the prefix, or the root's own key.
    ["other/a", null],
    ["dava", null],
    ["dav/", null],
    // Parts that are not valid names.
    ["dav//a", null],
    ["dav/a//", null],
    ["dav/a//b", null],
    ["dav/./a", null],
    ["dav/a/..", null],
    ["dav/a/../b", null],
    ["dav/a\u0000b", null],
    ["dav/\uD800", null],
    [`dav/${"a".repeat(256)}`, null],
    [`dav/${"中".repeat(86)}`, null],
    // A path of more than 900 bytes.
    [`dav/${Array.from({ length: 4 }, () => "a".repeat(250)).join("/")}`, null],
  ])("the key %j forms %j", (key, expected) => {
    expect(pathOfKey("dav/", key)).toEqual(expected);
  });

  it("reads every valid path back from its file and marker keys", () => {
    const name = fc.oneof(
      fc.constantFrom("a", "b c", "中文", "😀", "100%", "a+b", "#1", " ", "...", ".x", "&<>"),
      fc.string({ unit: "grapheme", minLength: 1, maxLength: 8 }),
    );
    fc.assert(
      fc.property(
        fc.constantFrom("", "dav/", "a b/中/"),
        fc.array(name, { minLength: 1, maxLength: 5 }),
        (prefix, path) => {
          fc.pre(path.every((part) => !part.includes("/") && part !== "." && part !== ".."));
          expect(pathOfKey(prefix, fileKey(prefix, path))).toEqual({ path, kind: "file" });
          expect(pathOfKey(prefix, markerKey(prefix, path))).toEqual({ path, kind: "collection" });
        },
      ),
      { numRuns: 500 },
    );
  });

  it("refuses a prefix that does not end at /", () => {
    expect(() => make("dav")).toThrow(/prefix/);
  });
});

describe("reading a one-level listing", () => {
  it.each([
    [
      "files and collections, sorted by name",
      ["dav/b", "dav/a", "dav/c b"],
      ["dav/d/", "dav/0/"],
      ["0/", "a", "b", "c b", "d/"],
    ],
    ["the collection's own marker is skipped", ["dav/"], ["dav/x/"], ["x/"]],
    [
      "a collection hides a file of its name",
      ["dav/photos", "dav/a"],
      ["dav/photos/"],
      ["a", "photos/"],
    ],
    [
      "parts that are not valid names are hidden",
      ["dav/ok", "dav/.."],
      ["dav//", "dav/./", "dav/../"],
      ["ok"],
    ],
    [
      "names of other scripts",
      ["dav/中文.txt", "dav/😀", "dav/a%2Fb", "dav/#+ %"],
      [],
      ["#+ %", "a%2Fb", "中文.txt", "😀"],
    ],
    ["keys outside the collection are skipped", ["other/x", "dav/x/deeper"], ["other/"], []],
  ])("%s", (_, objects, prefixes, expected) => {
    const entries = readLevel(
      "dav/",
      [],
      objects.map((key) => info(key)),
      prefixes,
    );
    expect(
      entries.map((entry) => `${entry.path.join("/")}${entry.kind === "collection" ? "/" : ""}`),
    ).toEqual(expected);
  });

  it("gives a file its object's size, ETag and time, and a collection none", () => {
    const [collection, file] = readLevel("", ["d"], [info("d/f", 7)], ["d/c/"]);
    expect(collection).toEqual({
      path: ["d", "c"],
      kind: "collection",
      size: 0,
      etag: COLLECTION_ETAG,
      modified: 0,
      created: 0,
      contentType: null,
    });
    expect(file).toEqual({
      path: ["d", "f"],
      kind: "file",
      size: 7,
      etag: "t-d/f",
      modified: 5,
      created: 5,
      contentType: null,
    });
  });

  it("hides a name that would make the path too long", () => {
    const deep = Array.from({ length: 3 }, () => "a".repeat(250));
    expect(readLevel("", deep, [info(`${deep.join("/")}/${"b".repeat(200)}`)], [])).toEqual([]);
  });
});

describe("reading a recursive listing", () => {
  it.each([
    ["an ordinary tree", ["d/", "d/a", "d/e/", "d/e/f"], 2, 1, false],
    ["collections without markers", ["d/x/y/z"], 1, 2, false],
    ["the own marker", ["d/"], 0, 0, false],
    ["an empty part", ["d/a", "d//b"], 1, 0, true],
    ["a dot part", ["d/./b"], 0, 0, true],
    ["a dot-dot part below a valid collection", ["d/x/../b"], 0, 1, true],
    ["a file hidden by a collection", ["d/x", "d/x/y"], 1, 1, true],
    ["a file hidden by a marker", ["d/x", "d/x/"], 0, 1, true],
  ])("%s", (_, keys, files, collections, hidden) => {
    const tree = readTree(
      "",
      ["d"],
      keys.map((key) => info(key)),
    );
    expect({
      files: tree.files.length,
      collections: tree.collections.length,
      hidden: tree.hidden,
    }).toEqual({ files, collections, hidden });
  });

  it("gives the paths of files and collections", () => {
    const tree = readTree("p/", [], [info("p/a/b/c"), info("p/a/"), info("p/z")]);
    expect(tree.files.map((file) => file.path)).toEqual([["a", "b", "c"], ["z"]]);
    expect(tree.collections).toEqual([["a"], ["a", "b"]]);
  });
});

describe("objects that other tools wrote", () => {
  it("shows a key's parts as collections, with markers or without", async () => {
    const { storage, driver } = make();
    driver.seed("dav/photos/2026/a.jpg", "jpg");
    expect(await names(storage, [])).toEqual(["photos/"]);
    expect(await names(storage, ["photos"])).toEqual(["2026/"]);
    expect(await names(storage, ["photos", "2026"])).toEqual(["a.jpg"]);
    const stat = await storage.stat(["photos", "2026"]);
    expect(stat.ok && stat.value.kind).toBe("collection");
  });

  it("shows a collection once and hides the file of its name", async () => {
    const { storage, driver } = make();
    seedAll(driver, ["dav/photos", "dav/photos/a.jpg"]);
    expect(await names(storage, [])).toEqual(["photos/"]);
    expect(await names(storage, ["photos"])).toEqual(["a.jpg"]);
    expect(await storage.read(["photos"])).toEqual(failed("is-collection"));
    expect(await storage.write(["photos"], text("x"), {})).toEqual(failed("is-collection"));
    expect(await storage.remove(["photos"])).toEqual(failed("hidden-objects"));
  });

  it("hides keys that form no path", async () => {
    const { storage, driver } = make();
    seedAll(driver, ["dav/docs/a.txt", "dav/docs//b.txt", "dav/docs/../c.txt", "dav/./d.txt"]);
    expect(await names(storage, [])).toEqual(["docs/"]);
    expect(await names(storage, ["docs"])).toEqual(["a.txt"]);
    expect(await storage.usage()).toEqual({
      ok: true,
      value: { files: 1, collections: 1, bytes: "dav/docs/a.txt".length },
    });
  });

  it.each([
    ["an empty part", "dav/docs//b.txt"],
    ["a dot-dot part", "dav/docs/../c.txt"],
    ["a file hidden by a collection", "dav/docs/x"],
    ["the collection's own file", "dav/docs"],
  ])("refuses to remove, copy or move a collection that holds %s", async (_, hidden) => {
    const { storage, driver } = make();
    seedAll(driver, ["dav/docs/a.txt", "dav/docs/x/y", hidden]);
    const before = driver.keys();
    for (const result of [
      await storage.remove(["docs"]),
      await storage.copy(["docs"], ["copy"], { overwrite: false, shallow: false }),
      await storage.move(["docs"], ["moved"], { overwrite: false }),
    ]) {
      expect(result).toEqual(failed("hidden-objects"));
    }
    expect(driver.keys()).toEqual(before);
  });

  it("refuses to replace a collection that holds hidden objects", async () => {
    const { storage, driver } = make();
    seedAll(driver, ["dav/src", "dav/dst/a", "dav/dst//b"]);
    expect(await storage.copy(["src"], ["dst"], { overwrite: true, shallow: false })).toEqual(
      failed("hidden-objects"),
    );
    expect(await storage.move(["src"], ["dst"], { overwrite: true })).toEqual(
      failed("hidden-objects"),
    );
    expect(driver.keys()).toEqual(["dav/dst//b", "dav/dst/a", "dav/src"]);
  });

  it("copies a collection with hidden objects shallowly, since none of them moves", async () => {
    const { storage, driver } = make();
    seedAll(driver, ["dav/docs/a", "dav/docs//b"]);
    expect(await storage.copy(["docs"], ["copy"], { overwrite: false, shallow: true })).toEqual({
      ok: true,
      value: { replaced: false },
    });
    expect(driver.keys()).toContain("dav/copy/");
  });

  it.each([
    ["removing the last file", (s: StorageBackend) => s.remove(["photos", "2026", "a.jpg"])],
    ["removing the last collection", (s: StorageBackend) => s.remove(["photos", "2026"])],
    [
      "moving the last file away",
      (s: StorageBackend) => s.move(["photos", "2026", "a.jpg"], ["a.jpg"], { overwrite: false }),
    ],
    [
      "moving the last collection away",
      (s: StorageBackend) => s.move(["photos", "2026"], ["2026"], { overwrite: false }),
    ],
  ])("keeps a collection without a marker when %s", async (_, change) => {
    const { storage, driver } = make();
    driver.seed("dav/photos/2026/a.jpg", "x");
    expect((await change(storage)).ok).toBe(true);
    const parent = (await storage.stat(["photos", "2026"])).ok ? ["photos", "2026"] : ["photos"];
    expect((await storage.stat(parent)).ok).toBe(true);
    expect(driver.keys()).toContain(markerKey("dav/", parent));
  });

  it("writes no marker for a collection that has one, or for the root", async () => {
    const { storage, driver } = make();
    seedAll(driver, ["dav/d/", "dav/d/f", "dav/g"]);
    await storage.remove(["d", "f"]);
    await storage.remove(["g"]);
    expect(driver.keys()).toEqual(["dav/d/"]);
  });

  it("keeps the destination's parent when it replaces its last entry", async () => {
    const { storage, driver } = make();
    seedAll(driver, ["dav/src", "dav/box/dst"]);
    driver.failWhen((call, key) =>
      call === "copy" ? (key === "dav/src" ? "unavailable" : null) : null,
    );
    expect(
      await storage.copy(["src"], ["box", "dst"], { overwrite: true, shallow: false }),
    ).toEqual(failed("unavailable"));
    // The copy failed after the destination went, and its parent stayed.
    expect(await names(storage, ["box"])).toEqual([]);
  });

  it("gives a collection copied from one without a marker a marker of its own", async () => {
    const { storage, driver } = make();
    driver.seed("dav/a/f", "x");
    expect((await storage.copy(["a"], ["b"], { overwrite: false, shallow: false })).ok).toBe(true);
    expect(driver.keys()).toEqual(["dav/a/f", "dav/b/", "dav/b/f"]);
    expect((await storage.move(["a"], ["c"], { overwrite: false })).ok).toBe(true);
    expect(driver.keys()).toEqual(["dav/b/", "dav/b/f", "dav/c/", "dav/c/f"]);
  });

  it("keeps the tree under its prefix and leaves other keys alone", async () => {
    const { storage, driver } = make("shared/dav/");
    seedAll(driver, ["other/x.txt", "shared/davx", "shared/dav.txt"]);
    await storage.write(["a.txt"], text("a"), { size: 1 });
    await storage.createCollection(["d"]);
    expect(await names(storage, [])).toEqual(["a.txt", "d/"]);
    await storage.remove(["a.txt"]);
    await storage.remove(["d"]);
    expect(driver.keys()).toEqual(["other/x.txt", "shared/dav.txt", "shared/davx"]);
    expect(await storage.usage()).toEqual({
      ok: true,
      value: { files: 0, collections: 0, bytes: 0 },
    });
  });

  it("skips a marker of the root that another tool wrote", async () => {
    const { storage, driver } = make();
    seedAll(driver, ["dav/", "dav/a"]);
    expect(await names(storage, [])).toEqual(["a"]);
    expect(await storage.usage()).toEqual({
      ok: true,
      value: { files: 1, collections: 0, bytes: 5 },
    });
  });

  it("takes the creation time of a file without one from its last change", async () => {
    let time = 1000;
    const driver = createMemoryDriver({ now: () => time });
    const storage = createObjectStoreStorage({
      driver,
      prefix: "",
      properties: createMemoryPropertyStore(),
      now: () => time,
    });
    driver.seed("f", "old");
    time = 2000;
    const written = await storage.write(["f"], text("new"), {});
    expect(written.ok && written.value.entry.created).toBe(1000);
    expect(written.ok && written.value.entry.modified).toBe(2000);
  });
});

describe("Unicode names", () => {
  it.each([
    ["CJK", "中文文件"],
    ["emoji", "😀🎉"],
    ["percent", "100%"],
    ["percent-encoding look-alike", "a%2Fb%20c"],
    ["plus", "a+b"],
    ["spaces", "  a  b  "],
    ["hash", "#tag"],
    ["combining marks", "é"],
    ["right-to-left", "שלום"],
  ])("keeps a name with %s through every operation", async (_, name) => {
    const { storage, driver } = make();
    expect((await storage.createCollection([name])).ok).toBe(true);
    expect((await storage.write([name, name], text(name), {})).ok).toBe(true);
    expect((await storage.patchProperties([name, name], [property("p")], [])).ok).toBe(true);
    expect(
      (await storage.copy([name], [`${name}2`], { overwrite: false, shallow: false })).ok,
    ).toBe(true);
    expect((await storage.move([name], [`${name}3`], { overwrite: false })).ok).toBe(true);
    expect(await snapshot(storage)).toEqual({
      [`${name}2/`]: "",
      [`${name}2/${name}`]: name,
      [`${name}3/`]: "",
      [`${name}3/${name}`]: name,
    });
    expect(driver.keys()).toEqual(
      sortedKeys([
        `dav/${name}2/`,
        `dav/${name}2/${name}`,
        `dav/${name}3/`,
        `dav/${name}3/${name}`,
      ]),
    );
    const props = await storage.properties([
      [`${name}3`, name],
      [`${name}2`, name],
      [name, name],
    ]);
    expect(props.ok && Object.keys(props.value).length).toBe(2);
  });
});

describe("writes", () => {
  it("refuses a stated size over S3's limit before reading the body", async () => {
    const { storage, driver } = make();
    const body = text("x");
    expect(await storage.write(["big"], body, { size: MAX_UPLOAD_BYTES + 1 })).toEqual(
      failed("too-large"),
    );
    expect(body.locked).toBe(false);
    expect(driver.keys()).toEqual([]);
  });

  it("refuses before reading the body when the write cannot succeed", async () => {
    const { storage, driver } = make();
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    expect(await storage.write(["d", "f"], body, {})).toEqual(failed("no-parent"));
    expect(cancel).toHaveBeenCalled();
    expect(driver.calls.some((made) => made.call === "put")).toBe(false);
  });

  it.each([
    ["a longer body", "abcd", 3],
    ["a shorter body", "ab", 3],
    ["no body", null, 3],
  ])("fails with a size mismatch for %s and keeps the old file", async (_, body, size) => {
    const { storage } = make();
    await storage.write(["f"], text("old"), {});
    expect(await storage.write(["f"], body === null ? null : text(body), { size })).toEqual(
      failed("size-mismatch"),
    );
    expect(await snapshot(storage)).toEqual({ f: "old" });
  });

  it("fails with a size mismatch when the body fails", async () => {
    const { storage } = make();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("the client went away"));
      },
    });
    expect(await storage.write(["f"], body, {})).toEqual(failed("size-mismatch"));
    expect(await snapshot(storage)).toEqual({});
  });

  it("gives the entry from the write when the store cannot show it yet", async () => {
    const driver = createMemoryDriver();
    const lagging: ObjectStoreDriver = {
      ...driver,
      head: async (key) =>
        driver.objects.has(key) && key !== "f" ? driver.head(key) : { ok: true, value: null },
    };
    const storage = createObjectStoreStorage({
      driver: lagging,
      prefix: "",
      properties: createMemoryPropertyStore(),
      now: () => 42,
    });
    const written = await storage.write(["f"], text("abc"), { contentType: "text/plain" });
    expect(written).toEqual({
      ok: true,
      value: {
        created: true,
        entry: {
          path: ["f"],
          kind: "file",
          size: 3,
          etag: "e1",
          modified: 42,
          created: 42,
          contentType: "text/plain",
        },
      },
    });
  });

  it("leaves no properties behind for a new file or collection of an old name", async () => {
    const properties = createMemoryPropertyStore();
    await properties.patch(["f"], [property("stale")], []);
    await properties.patch(["d"], [property("stale")], []);
    const { storage } = make("", 1000, properties);
    await storage.write(["f"], text("x"), {});
    await storage.createCollection(["d"]);
    expect(await storage.properties([["f"], ["d"]])).toEqual({ ok: true, value: { f: [], d: [] } });
  });
});

describe("reads", () => {
  it.each([
    [{ start: 2, stop: 5 }, "234"],
    [{ start: 0, stop: 10 }, "0123456789"],
    [{ start: 8, stop: 20 }, "89"],
    [{ start: 10, stop: 12 }, ""],
    [{ start: 4, stop: 4 }, ""],
  ])("reads the range %j", async (range, expected) => {
    const { storage } = make();
    await storage.write(["f"], text("0123456789"), {});
    const read = await storage.read(["f"], range);
    expect(read.ok && (await new Response(read.value.body).text())).toBe(expected);
  });

  it("fails rather than end short when the store sends fewer bytes", async () => {
    const driver = createMemoryDriver();
    const short: ObjectStoreDriver = {
      ...driver,
      get: async (key, range) => {
        const read = await driver.get(key, range);
        return read.ok && read.value
          ? { ok: true, value: { ...read.value, body: text("01") } }
          : read;
      },
    };
    const storage = createObjectStoreStorage({
      driver: short,
      prefix: "",
      properties: createMemoryPropertyStore(),
    });
    await storage.write(["f"], text("0123456789"), {});
    for (const range of [undefined, { start: 1, stop: 5 }]) {
      const read = await storage.read(["f"], range);
      if (!read.ok) throw new Error("the read failed");
      await expect(new Response(read.value.body).text()).rejects.toThrow(/ended short/);
    }
  });

  it("answers not found when the file goes between the head and the read", async () => {
    const driver = createMemoryDriver();
    const vanishing: ObjectStoreDriver = {
      ...driver,
      get: () => Promise.resolve({ ok: true, value: null }),
    };
    const storage = createObjectStoreStorage({
      driver: vanishing,
      prefix: "",
      properties: createMemoryPropertyStore(),
    });
    await storage.write(["f"], text("x"), {});
    expect(await storage.read(["f"])).toEqual(failed("not-found"));
  });
});

/** A collection `src` with three files, the first with a property. */
const tree = async () => {
  const made = make();
  await made.storage.createCollection(["src"]);
  for (const name of ["a", "b", "c"]) await made.storage.write(["src", name], text(name), {});
  await made.storage.patchProperties(["src", "a"], [property("p")], []);
  return made;
};

/** RustFS's rule for keys in short: no part that is `..` once split at `\`, no long marker. */
const rustfsLike = (key: string) =>
  key.split(/[/\\]/).some((part) => part.trim() === "..") ||
  key.split("/").some((part, index, parts) => index === parts.length - 2 && part.length > 246);

/** An adapter on a memory driver that refuses keys as RustFS does. */
const refusing = () => {
  const made = make();
  made.driver.refuseKeys(rustfsLike);
  return made;
};

/** A tree whose collection `src` holds keys that the store refuses only below `dst`. */
const refusedBelow = async () => {
  const made = make();
  const { storage, driver } = made;
  await storage.createCollection(["src"]);
  await storage.createCollection(["src", "deep"]);
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      storage.write(["src", index === 7 ? "deep" : "top", `f${index}`], text("x"), {}),
    ),
  );
  await storage.write(["src", "deep", "bad"], text("x"), {});
  // As AWS S3 refuses a key past 1,024 bytes: the marker and most keys arrive, one does not.
  driver.refuseKeys((key) => key === "dav/dst/deep/bad");
  return made;
};

/**
 * An adapter on a memory driver whose head and read of `dav/b` are refused although the object
 * exists, as AWS S3 answers HEAD of an object stored with a customer's key (SSE-C).
 */
const refusingHeadOfB = () => {
  const driver = createMemoryDriver();
  const reads: ObjectStoreDriver = {
    ...driver,
    head: async (key) => (key === "dav/b" ? fail("name-refused") : await driver.head(key)),
    get: async (key, range) =>
      key === "dav/b" ? fail("name-refused") : await driver.get(key, range),
  };
  const properties = createMemoryPropertyStore();
  const storage = createObjectStoreStorage({ driver: reads, prefix: "dav/", properties });
  return { driver, properties, storage };
};

describe("an object whose head the store refuses", () => {
  it("is not taken for absent while a listing shows it", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { driver, properties, storage } = refusingHeadOfB();
    driver.seed("dav/a", "a");
    driver.seed("dav/b", "b");
    driver.seed("dav/bc", "bc");
    await properties.patch(["b"], [property("p")], []);
    const unavailable = failed("unavailable");
    expect(await storage.stat(["b"])).toEqual(unavailable);
    expect(await storage.read(["b"])).toEqual(unavailable);
    expect(await storage.copy(["a"], ["b"], { overwrite: false, shallow: false })).toEqual(
      unavailable,
    );
    expect(await storage.move(["a"], ["b"], { overwrite: false })).toEqual(unavailable);
    expect(await storage.write(["b"], text("new"), {})).toEqual(unavailable);
    expect(driver.objects.get("dav/b")?.bytes).toEqual(new TextEncoder().encode("b"));
    expect(driver.keys()).toEqual(["dav/a", "dav/b", "dav/bc"]);
    expect(await properties.get([["b"]])).toEqual({ ok: true, value: { b: [property("p")] } });
    expect(errors).toHaveBeenCalledWith("the store refused to read an object it lists", "dav/b");
  });

  it("is absent when no listing shows it, though a longer key starts with it", async () => {
    const { driver, storage } = refusingHeadOfB();
    driver.seed("dav/a", "a");
    driver.seed("dav/bc", "bc");
    expect(await storage.stat(["b"])).toEqual(failed("not-found"));
    expect(await storage.copy(["a"], ["b"], { overwrite: false, shallow: false })).toEqual({
      ok: true,
      value: { replaced: false },
    });
  });

  it("is absent when the store refuses its key as a prefix too", async () => {
    const { driver, storage } = refusingHeadOfB();
    driver.refuseKeys((key) => key === "dav/b");
    expect(await storage.stat(["b"])).toEqual(failed("not-found"));
  });

  it("passes on any other failure of the listing that would confirm it", async () => {
    const { driver, storage } = refusingHeadOfB();
    driver.failWhen((call, key) => (call === "list" && key === "dav/b" ? "unavailable" : null));
    expect(await storage.stat(["b"])).toEqual(failed("unavailable"));
  });
});

/** An adapter on a memory driver that refuses every page of a listing after the first. */
const refusingLaterPages = () => {
  const driver = createMemoryDriver({ pageSize: 2 });
  const pages: ObjectStoreDriver = {
    ...driver,
    list: async (key, options) =>
      options.cursor ? fail("name-refused") : await driver.list(key, options),
  };
  const storage = createObjectStoreStorage({
    driver: pages,
    prefix: "dav/",
    properties: createMemoryPropertyStore(),
  });
  return { driver, storage };
};

describe("keys the store refuses", () => {
  const odd = "..\\x";

  it("finds no entry at a refused name, nor any below it", async () => {
    const { storage } = refusing();
    expect(await storage.stat([odd])).toEqual(failed("not-found"));
    expect(await storage.stat([odd, "f"])).toEqual(failed("not-found"));
    expect(await storage.read([odd])).toEqual(failed("not-found"));
    expect(await storage.list([odd])).toEqual(failed("not-found"));
    expect(await storage.remove([odd])).toEqual(failed("not-found"));
    expect(await storage.properties([[odd]])).toEqual({ ok: true, value: {} });
    expect(await storage.write([odd, "f"], text("x"), {})).toEqual(failed("no-parent"));
  });

  it("refuses to create an entry of a refused name and changes nothing", async () => {
    const { storage, driver } = refusing();
    await storage.write(["a"], text("a"), {});
    await storage.createCollection(["box"]);
    const before = driver.keys();
    expect(await storage.write([odd], text("x"), { size: 1 })).toEqual(failed("name-refused"));
    expect(await storage.write([odd], text("x"), {})).toEqual(failed("name-refused"));
    expect(await storage.createCollection([odd])).toEqual(failed("name-refused"));
    expect(await storage.createCollection(["n".repeat(247)])).toEqual(failed("name-refused"));
    expect(await storage.copy(["a"], [odd], { overwrite: false, shallow: false })).toEqual(
      failed("name-refused"),
    );
    expect(await storage.move(["a"], [odd], { overwrite: true })).toEqual(failed("name-refused"));
    expect(await storage.copy(["box"], [odd], { overwrite: false, shallow: true })).toEqual(
      failed("name-refused"),
    );
    expect(driver.keys()).toEqual(before);
    expect(await snapshot(storage)).toEqual({ a: "a", "box/": "" });
  });

  it("keeps a file and the entries below a name whose marker it refuses", async () => {
    const { storage } = refusing();
    const long = "n".repeat(255);
    expect((await storage.write([long], text("x"), {})).ok).toBe(true);
    expect(await names(storage, [])).toEqual([long]);
    expect(await storage.remove([long])).toEqual({ ok: true, value: null });
    expect(await storage.createCollection([long])).toEqual(failed("name-refused"));
    expect(await storage.stat([long])).toEqual(failed("not-found"));
  });

  it.each(["copy", "move"] as const)(
    "refuses to %s a collection onto a name whose marker it refuses, before anything arrives",
    async (method) => {
      const { storage, driver } = refusing();
      await storage.createCollection(["box"]);
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          storage.write(["box", `f${index}`], text("x"), {}),
        ),
      );
      const before = driver.keys();
      const long = "n".repeat(255);
      const result =
        method === "copy"
          ? await storage.copy(["box"], [long], { overwrite: false, shallow: false })
          : await storage.move(["box"], [long], { overwrite: false });
      expect(result).toEqual(failed("name-refused"));
      expect(driver.keys()).toEqual(before);
    },
  );

  it.each(["copy", "move"] as const)(
    "takes back what a %s of a collection copied when the store refuses a key below it",
    async (method) => {
      const { storage, driver } = await refusedBelow();
      const before = driver.keys();
      const result =
        method === "copy"
          ? await storage.copy(["src"], ["dst"], { overwrite: false, shallow: false })
          : await storage.move(["src"], ["dst"], { overwrite: false });
      expect(result).toEqual(failed("name-refused"));
      expect(driver.keys()).toEqual(before);
      expect(await storage.stat(["dst"])).toEqual(failed("not-found"));
    },
  );

  it.each(["copy", "move"] as const)(
    "says the replaced destination is gone when a %s over it is refused below it",
    async (method) => {
      const { storage, driver } = await refusedBelow();
      await storage.createCollection(["dst"]);
      await storage.write(["dst", "old"], text("old"), {});
      const source = driver.keys().filter((key) => key.startsWith("dav/src/"));
      const result =
        method === "copy"
          ? await storage.copy(["src"], ["dst"], { overwrite: true, shallow: false })
          : await storage.move(["src"], ["dst"], { overwrite: true });
      expect(result).toEqual(failed("name-refused-replaced"));
      // The source is whole, and nothing of it, nor of the old destination, is at `dst`.
      expect(driver.keys()).toEqual(source);
      expect(await storage.stat(["dst"])).toEqual(failed("not-found"));
    },
  );

  it("says the replaced destination is gone when a file copied over it is refused", async () => {
    const { storage, driver } = make();
    await storage.write(["a"], text("a"), {});
    await storage.write(["b"], text("b"), {});
    driver.refuseKeys((key) => key === "dav/b" && driver.objects.get("dav/b") === undefined);
    expect(await storage.copy(["a"], ["b"], { overwrite: true, shallow: false })).toEqual(
      failed("name-refused-replaced"),
    );
    expect(driver.keys()).toEqual(["dav/a"]);
  });

  it("fails rather than cut a listing short when the store refuses a later page", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { driver, storage } = refusingLaterPages();
    seedAll(driver, ["dav/big/", "dav/big/a", "dav/big/b", "dav/big/c", "dav/big/d", "dav/e"]);
    const before = driver.keys();
    expect(await storage.list(["big"])).toEqual(failed("unavailable"));
    expect(await storage.remove(["big"])).toEqual(failed("unavailable"));
    expect(await storage.move(["big"], ["moved"], { overwrite: false })).toEqual(
      failed("unavailable"),
    );
    expect(await storage.copy(["e"], ["big"], { overwrite: true, shallow: false })).toEqual(
      failed("unavailable"),
    );
    expect(await storage.usage()).toEqual(failed("unavailable"));
    expect(driver.keys()).toEqual(before);
    expect(errors).toHaveBeenCalledWith("the store refused a later page of a listing", "dav/big/");
    // The first page of a refused prefix still finds nothing there.
    driver.refuseKeys((key) => key.startsWith("dav/odd"));
    expect(await storage.stat(["odd"])).toEqual(failed("not-found"));
  });
});

describe("failures part-way", () => {
  it("a move whose removal fails leaves the entries in both places", async () => {
    const { storage, driver } = await tree();
    driver.failWhen((call) => (call === "delete" ? "unavailable" : null));
    expect(await storage.move(["src"], ["dst"], { overwrite: false })).toEqual(
      failed("unavailable"),
    );
    driver.failWhen(null);
    const files = { "src/": "", "src/a": "a", "src/b": "b", "src/c": "c" };
    expect(await snapshot(storage)).toEqual({
      ...files,
      "dst/": "",
      "dst/a": "a",
      "dst/b": "b",
      "dst/c": "c",
    });
    const props = await storage.properties([["dst", "a"]]);
    expect(props.ok && props.value["dst/a"]).toEqual([property("p")]);
  });

  it("a resumed move takes back what it added when the store refuses a name", async () => {
    const { storage, driver } = await tree();
    driver.failWhen((call) => (call === "delete" ? "unavailable" : null));
    await storage.move(["src"], ["dst"], { overwrite: false });
    driver.failWhen(null);
    // Something arrived in the source since, whose name the store refuses at the destination.
    driver.seed("dav/src/new", "new");
    driver.seed("dav/src/new2", "new2");
    driver.refuseKeys((key) => key === "dav/dst/new2");
    const before = driver.keys();
    expect(await storage.move(["src"], ["dst"], { overwrite: true })).toEqual(
      failed("name-refused"),
    );
    expect(driver.keys()).toEqual(before);
  });

  it("a move whose copies fail keeps the source whole", async () => {
    const { storage, driver } = await tree();
    driver.failWhen((call, key) => (call === "copy" && key === "dav/src/b" ? "unavailable" : null));
    expect(await storage.move(["src"], ["dst"], { overwrite: false })).toEqual(
      failed("unavailable"),
    );
    driver.failWhen(null);
    expect(await snapshot(storage, ["src"])).toEqual({ "src/a": "a", "src/b": "b", "src/c": "c" });
    const props = await storage.properties([["src", "a"]]);
    expect(props.ok && props.value["src/a"]).toEqual([property("p")]);
  });

  it.each(["head", "list", "put", "delete", "copy", "get"] as const)(
    "answers what the store answered when %s fails",
    async (failing) => {
      const { storage, driver } = await tree();
      driver.failWhen((call) => (call === failing ? "insufficient-storage" : null));
      const results = [
        await storage.stat(["src", "a"]),
        await storage.list(["src"]),
        await storage.read(["src", "a"]),
        await storage.write(["src", "d"], text("d"), {}),
        await storage.createCollection(["new"]),
        await storage.remove(["src", "a"]),
        await storage.copy(["src"], ["copy"], { overwrite: false, shallow: false }),
        await storage.move(["src", "b"], ["b"], { overwrite: false }),
        await storage.properties([["src"]]),
        await storage.patchProperties(["src"], [property("q")], []),
        await storage.usage(),
      ];
      const failures = results.flatMap((result) => (result.ok ? [] : [result.failure]));
      expect(failures.length).toBeGreaterThan(0);
      expect(new Set(failures)).toEqual(new Set(["insufficient-storage"]));
    },
  );

  it.each(["get", "patch", "copyTree", "moveTree", "removeTree"] as const)(
    "answers unavailable when the property store's %s fails",
    async (failing) => {
      const working = createMemoryPropertyStore();
      const properties: PropertyStore = {
        ...working,
        [failing]: () => Promise.resolve(failed("unavailable")),
      };
      const { storage } = make("", 1000, properties);
      await working.patch([], [], []);
      await storage.createCollection(["d"]).catch(() => undefined);
      const results = [
        await storage.write(["f"], text("x"), {}),
        await storage.createCollection(["e"]),
        await storage.properties([["d"]]),
        await storage.patchProperties([], [property("p")], []),
        await storage.copy(["d"], ["c"], { overwrite: false, shallow: false }),
        await storage.copy(["d"], ["s"], { overwrite: false, shallow: true }),
        await storage.move(["d"], ["m"], { overwrite: false }),
        await storage.remove(["e"]),
      ];
      expect(results.some((result) => !result.ok && result.failure === "unavailable")).toBe(true);
    },
  );

  it("answers not found when the source file goes before it is copied", async () => {
    const driver = createMemoryDriver();
    const vanishing: ObjectStoreDriver = {
      ...driver,
      copy: () => Promise.resolve({ ok: true, value: false }),
    };
    const storage = createObjectStoreStorage({
      driver: vanishing,
      prefix: "",
      properties: createMemoryPropertyStore(),
    });
    await storage.write(["f"], text("x"), {});
    expect(await storage.copy(["f"], ["g"], { overwrite: false, shallow: false })).toEqual(
      failed("not-found"),
    );
  });

  it("answers unavailable when a driver throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const driver = createMemoryDriver();
    const throwing: ObjectStoreDriver = {
      ...driver,
      head: () => Promise.reject(new Error("a driver bug")),
    };
    const storage = createObjectStoreStorage({
      driver: throwing,
      prefix: "",
      properties: createMemoryPropertyStore(),
    });
    const body = text("x");
    expect(await storage.stat(["f"])).toEqual(failed("unavailable"));
    expect(await storage.write(["f"], body, {})).toEqual(failed("unavailable"));
    expect(body.locked).toBe(false);
  });
});

describe("dead properties", () => {
  it("finds the members of a collection in one listing", async () => {
    const { storage, driver } = make();
    await storage.createCollection(["d"]);
    for (const name of ["a", "b", "c", "e"]) await storage.write(["d", name], text(name), {});
    await storage.patchProperties(["d", "b"], [property("p")], []);
    driver.calls.length = 0;
    const found = await storage.properties([
      [],
      ["d"],
      ["d", "a"],
      ["d", "b"],
      ["d", "c"],
      ["d", "zz"],
    ]);
    expect(found).toEqual({
      ok: true,
      value: { "": [], d: [], "d/a": [], "d/b": [property("p")], "d/c": [] },
    });
    expect(driver.calls.filter((made) => made.call === "head").length).toBe(2);
  });

  it("gives nothing for members of a parent that is not a collection", async () => {
    const { storage } = make();
    await storage.write(["f"], text("x"), {});
    expect(
      await storage.properties([
        ["f", "a"],
        ["f", "b"],
        ["f", "c"],
      ]),
    ).toEqual({ ok: true, value: {} });
  });

  it("copies only the collection's own properties in a shallow copy", async () => {
    const { storage } = make();
    await storage.createCollection(["d"]);
    await storage.write(["d", "f"], text("x"), {});
    await storage.patchProperties(["d"], [property("own")], []);
    await storage.patchProperties(["d", "f"], [property("child")], []);
    await storage.copy(["d"], ["s"], { overwrite: false, shallow: true });
    await storage.createCollection(["e"]);
    await storage.copy(["e"], ["t"], { overwrite: false, shallow: true });
    expect(await storage.properties([["s"], ["t"]])).toEqual({
      ok: true,
      value: { s: [property("own")], t: [] },
    });
  });

  it("refuses to set properties of a path that does not exist", async () => {
    const { storage } = make();
    expect(await storage.patchProperties(["nope"], [property("p")], [])).toEqual(
      failed("not-found"),
    );
  });

  it("keeps properties of the root", async () => {
    const { storage } = make();
    expect(await storage.patchProperties([], [property("r")], [])).toEqual({
      ok: true,
      value: null,
    });
    expect(await storage.properties([[]])).toEqual({ ok: true, value: { "": [property("r")] } });
  });
});

describe("large collections", () => {
  it("removes more keys than one batch deletes", async () => {
    const { storage, driver } = make("", 400);
    for (let index = 0; index < 1203; index += 1) driver.seed(`big/f${index}`);
    expect(await storage.usage()).toEqual({
      ok: true,
      value: { files: 1203, collections: 1, bytes: 0 },
    });
    expect(await storage.remove(["big"])).toEqual({ ok: true, value: null });
    expect(driver.keys()).toEqual([]);
  });
});

describe("the size limit", () => {
  it.each([
    ["stated", 5],
    ["unknown", undefined],
  ])("refuses a body over the limit whose length is %s, and keeps nothing", async (_, size) => {
    const driver = createMemoryDriver();
    const storage = createObjectStoreStorage({
      driver,
      prefix: "",
      properties: createMemoryPropertyStore(),
      maxFileSize: 4,
    });
    expect(await storage.write(["big"], text("12345"), { size })).toEqual(failed("too-large"));
    expect((await storage.stat(["big"])).ok).toBe(false);
    expect((await storage.write(["ok"], text("1234"), {})).ok).toBe(true);
  });
});

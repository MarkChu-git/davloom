import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "./memory-storage";
import { createMountedStorage, type Mount } from "./mounts";
import type { StorageBackend } from "./storage";
import { snapshot, storageContract } from "./testing/storage-contract";

const stream = (text: string) => new Blob([text]).stream();

const namespace = async () => {
  const one = createMemoryStorage();
  const two = createMemoryStorage();
  await one.createCollection(["sub"]);
  await one.createCollection(["sub", "inner"]);
  const mounts: Mount[] = [
    { name: "a", backendId: "one", backend: one, root: [] },
    { name: "s", backendId: "one", backend: one, root: ["sub"] },
    { name: "b", backendId: "two", backend: two, root: [] },
  ];
  return { one, two, storage: createMountedStorage(mounts, 7) };
};

const p = (path: readonly string[]) => ["m", ...path];

// A Mount of a backend's root behaves like the backend itself, below the Mount's name.
const prefixed = (inner: StorageBackend): StorageBackend => {
  const storage = createMountedStorage([{ name: "m", backendId: "x", backend: inner, root: [] }]);
  return {
    stat: async (path) => {
      const result = await storage.stat(p(path));
      return result.ok
        ? { ok: true, value: { ...result.value, path: result.value.path.slice(1) } }
        : result;
    },
    list: async (path) => {
      const result = await storage.list(p(path));
      return result.ok
        ? { ok: true, value: result.value.map((e) => ({ ...e, path: e.path.slice(1) })) }
        : result;
    },
    read: (path, range) => storage.read(p(path), range),
    write: (path, body, options) =>
      path.length === 0 ? inner.write(path, body, options) : storage.write(p(path), body, options),
    createCollection: (path) =>
      path.length === 0 ? inner.createCollection(path) : storage.createCollection(p(path)),
    remove: (path) => (path.length === 0 ? inner.remove(path) : storage.remove(p(path))),
    copy: (from, to, options) =>
      from.length === 0 || to.length === 0
        ? inner.copy(from, to, options)
        : storage.copy(p(from), p(to), options),
    move: (from, to, options) =>
      from.length === 0 || to.length === 0
        ? inner.move(from, to, options)
        : storage.move(p(from), p(to), options),
    properties: async (paths) => {
      const result = await storage.properties(paths.map(p));
      if (!result.ok) return result;
      return {
        ok: true,
        value: Object.fromEntries(Object.entries(result.value).map(([k, v]) => [k.slice(2), v])),
      };
    },
    patchProperties: (path, set, remove) => storage.patchProperties(p(path), set, remove),
    usage: () => storage.usage(),
  };
};

storageContract("a Mount of a memory backend", {
  make: () => prefixed(createMemoryStorage()),
  runs: 100,
});

describe("mounted storage", () => {
  it("presents the Mounts as the root's members", async () => {
    const { storage } = await namespace();
    const root = await storage.stat([]);
    expect(root).toEqual({
      ok: true,
      value: expect.objectContaining({ kind: "collection", created: 7 }),
    });
    const listed = await storage.list([]);
    expect(listed.ok && listed.value.map((e) => e.path)).toEqual([["a"], ["s"], ["b"]]);
  });

  it("maps a Mount's paths into its root in the backend", async () => {
    const { one, storage } = await namespace();
    expect((await storage.write(["s", "inner", "f"], stream("x"), {})).ok).toBe(true);
    expect((await one.stat(["sub", "inner", "f"])).ok).toBe(true);
    const listed = await storage.list(["s", "inner"]);
    expect(listed.ok && listed.value.map((e) => e.path)).toEqual([["s", "inner", "f"]]);
    const read = await storage.read(["s", "inner", "f"]);
    expect(read.ok && read.value.entry.path).toEqual(["s", "inner", "f"]);
    const entry = await storage.stat(["s", "inner", "f"]);
    expect(entry.ok && entry.value.path).toEqual(["s", "inner", "f"]);
    const created = await storage.createCollection(["s", "new"]);
    expect(created.ok && created.value.path).toEqual(["s", "new"]);
  });

  it.each([
    [
      "write a Mount's root",
      (s: StorageBackend) => s.write(["a"], stream("x"), {}),
      "is-collection",
    ],
    ["write at the root", (s: StorageBackend) => s.write(["x"], stream("x"), {}), "root"],
    [
      "write under an unknown Mount",
      (s: StorageBackend) => s.write(["x", "y"], null, {}),
      "not-found",
    ],
    ["create a Mount's root", (s: StorageBackend) => s.createCollection(["a"]), "exists"],
    ["create the root", (s: StorageBackend) => s.createCollection([]), "exists"],
    ["create at the root", (s: StorageBackend) => s.createCollection(["new"]), "root"],
    ["remove a Mount's root", (s: StorageBackend) => s.remove(["a"]), "root"],
    ["remove the root", (s: StorageBackend) => s.remove([]), "root"],
    ["remove under an unknown Mount", (s: StorageBackend) => s.remove(["x", "y"]), "not-found"],
    ["move a Mount", (s: StorageBackend) => s.move(["a"], ["a", "x"], { overwrite: true }), "root"],
    ["move the root", (s: StorageBackend) => s.move([], ["a", "x"], { overwrite: true }), "root"],
    [
      "copy the root",
      (s: StorageBackend) => s.copy([], ["a", "x"], { overwrite: true, shallow: false }),
      "into-itself",
    ],
    [
      "copy from an unknown Mount",
      (s: StorageBackend) => s.copy(["x", "y"], ["a", "x"], { overwrite: true, shallow: false }),
      "not-found",
    ],
    [
      "copy onto a Mount",
      (s: StorageBackend) => s.copy(["a", "f"], ["b"], { overwrite: true, shallow: false }),
      "root",
    ],
    [
      "copy to the root",
      (s: StorageBackend) => s.copy(["a", "f"], ["x"], { overwrite: true, shallow: false }),
      "root",
    ],
    [
      "copy between backends",
      (s: StorageBackend) => s.copy(["a", "f"], ["b", "f"], { overwrite: true, shallow: false }),
      "cross-backend",
    ],
    ["read the root", (s: StorageBackend) => s.read([]), "is-collection"],
    ["read an unknown Mount", (s: StorageBackend) => s.read(["x", "y"]), "not-found"],
    ["stat an unknown Mount", (s: StorageBackend) => s.stat(["x"]), "not-found"],
    ["list an unknown Mount", (s: StorageBackend) => s.list(["x"]), "not-found"],
    ["set a property of the root", (s: StorageBackend) => s.patchProperties([], [], []), "root"],
    [
      "set a property under an unknown Mount",
      (s: StorageBackend) => s.patchProperties(["x", "y"], [], []),
      "not-found",
    ],
  ])("refuses to %s", async (_, operation, failure) => {
    const { storage } = await namespace();
    await storage.write(["a", "f"], stream("x"), {});
    expect(await operation(storage)).toEqual({ ok: false, failure });
  });

  it("copies and moves between two Mounts of one backend", async () => {
    const { one, storage } = await namespace();
    await storage.write(["a", "f"], stream("x"), {});
    expect(
      await storage.copy(["a", "f"], ["s", "g"], { overwrite: false, shallow: false }),
    ).toEqual({ ok: true, value: { replaced: false } });
    expect(await storage.move(["s", "g"], ["a", "h"], { overwrite: false })).toEqual({
      ok: true,
      value: { replaced: false },
    });
    expect(await snapshot(one)).toEqual({ f: "x", h: "x", "sub/": "", "sub/inner/": "" });
  });

  it("reads properties across Mounts and skips unknown paths", async () => {
    const { storage } = await namespace();
    await storage.write(["a", "f"], stream("x"), {});
    await storage.write(["b", "g"], stream("x"), {});
    await storage.patchProperties(["a", "f"], [{ name: "{u}p", xml: "<p/>" }], []);
    const result = await storage.properties([["a", "f"], ["b", "g"], ["x", "y"], []]);
    expect(result).toEqual({
      ok: true,
      value: { "a/f": [{ name: "{u}p", xml: "<p/>" }], "b/g": [] },
    });
  });

  it("asks the Mount's backend for its quota, or falls back to its usage", async () => {
    const limited = createMemoryStorage({ capacity: 10 });
    const plain = createMemoryStorage();
    const withoutQuota: StorageBackend = { ...plain, quota: undefined };
    const storage = createMountedStorage([
      { name: "l", backendId: "l", backend: limited, root: [] },
      { name: "p", backendId: "p", backend: withoutQuota, root: [] },
    ]);
    await storage.write(["l", "f"], stream("abc"), {});
    await storage.write(["p", "f"], stream("ab"), {});
    expect(await storage.quota?.(["l"])).toEqual({ ok: true, value: { used: 3, available: 7 } });
    expect(await storage.quota?.(["p"])).toEqual({ ok: true, value: { used: 2, available: null } });
    expect(await storage.quota?.([])).toEqual({ ok: false, failure: "not-collection" });
    expect(await storage.quota?.(["x", "y"])).toEqual({ ok: false, failure: "not-found" });
  });

  it("counts each backend once", async () => {
    const { storage } = await namespace();
    await storage.write(["a", "f"], stream("abc"), {});
    await storage.write(["b", "g"], stream("de"), {});
    expect(await storage.usage()).toEqual({
      ok: true,
      value: { files: 2, collections: 2, bytes: 5 },
    });
  });

  it("passes on a failure of a backend", async () => {
    const broken: StorageBackend = {
      ...createMemoryStorage(),
      usage: () => Promise.resolve({ ok: false, failure: "unavailable" }),
      properties: () => Promise.resolve({ ok: false, failure: "unavailable" }),
    };
    const storage = createMountedStorage([
      { name: "x", backendId: "x", backend: broken, root: ["missing"] },
    ]);
    expect(await storage.usage()).toEqual({ ok: false, failure: "unavailable" });
    expect(await storage.properties([["x"]])).toEqual({ ok: false, failure: "unavailable" });
    // A Mount whose root is missing is left out of the listing.
    expect(await storage.list([])).toEqual({ ok: true, value: [] });
    expect((await storage.list(["x"])).ok).toBe(false);
    expect((await storage.stat(["x"])).ok).toBe(false);
  });
});

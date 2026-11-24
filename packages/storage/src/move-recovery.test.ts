import {
  createMemoryPropertyStore,
  type PropertyStore,
  type StorageBackend,
  type StorageFailure,
} from "@davloom/core";
import { snapshot } from "@davloom/core/testing";
import { describe, expect, it } from "vitest";
import { createObjectStoreStorage } from "./object-store";
import { createMemoryDriver, type MemoryDriver } from "./testing/memory-driver";

// The synchronous limit of copies and moves, and the recovery of a move that stopped while it
// removed its source (PRD §5), on the object-store adapter.

const text = (value: string) => new Blob([value]).stream();
const failed = (failure: StorageFailure) => ({ ok: false, failure });

/** A Property Store whose calls can fail, counting every call. */
const failingProperties = () => {
  const inner = createMemoryPropertyStore();
  let rule: ((call: string) => boolean) | null = null;
  const calls: string[] = [];
  const wrap =
    <A extends unknown[], R>(call: string, run: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R | { ok: false; failure: "unavailable" }> => {
      calls.push(call);
      if (rule?.(call)) return { ok: false, failure: "unavailable" };
      return await run(...args);
    };
  const store: PropertyStore = {
    get: wrap("get", (paths) => inner.get(paths)),
    patch: wrap("patch", (path, set, remove) => inner.patch(path, set, remove)),
    copyTree: wrap("copyTree", (from, to) => inner.copyTree(from, to)),
    moveTree: wrap("moveTree", (from, to) => inner.moveTree(from, to)),
    removeTree: wrap("removeTree", (path) => inner.removeTree(path)),
  };
  return {
    store,
    calls,
    failWhen: (next: ((call: string) => boolean) | null) => {
      rule = next;
    },
  };
};

const make = (maxEntries?: number) => {
  const driver = createMemoryDriver();
  const properties = failingProperties();
  const storage = createObjectStoreStorage({
    driver,
    prefix: "dav/",
    properties: properties.store,
    ...(maxEntries === undefined ? {} : { maxEntries }),
  });
  return { driver, properties, storage };
};

const seedFiles = (driver: MemoryDriver, count: number) => {
  for (let i = 0; i < count; i += 1) driver.seed(`dav/src/f${String(i).padStart(4, "0")}`, `v${i}`);
};

const fileCount = (tree: Record<string, string>, root: string) =>
  Object.keys(tree).filter((key) => key.startsWith(`${root}/f`)).length;

describe("a move that stopped while removing its source", () => {
  it("resumes on a retry with Overwrite: T, and loses nothing", async () => {
    const { driver, storage } = make();
    await storage.createCollection(["src"]);
    seedFiles(driver, 1005);
    // The second batch of keys fails. The first 1,000 keys, the collection's marker and 999 files,
    // are gone from the source.
    driver.failWhen((call, key) =>
      call === "delete" && key === "dav/src/f1003" ? "unavailable" : null,
    );
    expect(await storage.move(["src"], ["dst"], { overwrite: true })).toEqual(
      failed("unavailable"),
    );
    driver.failWhen(null);
    const stopped = await snapshot(storage);
    expect(fileCount(stopped, "dst")).toBe(1005);
    expect(fileCount(stopped, "src")).toBe(6);

    expect(await storage.move(["src"], ["dst"], { overwrite: true })).toEqual({
      ok: true,
      value: { replaced: true },
    });
    const done = await snapshot(storage);
    expect(fileCount(done, "dst")).toBe(1005);
    expect(done["dst/f0000"]).toBe("v0");
    expect(done["dst/f1004"]).toBe("v1004");
    expect(Object.keys(done).some((key) => key.startsWith("src"))).toBe(false);
    expect(await storage.move(["src"], ["dst"], { overwrite: true })).toEqual(failed("not-found"));
  });

  it("copies over the destination what was added to the source since", async () => {
    const { driver, storage } = make();
    await storage.createCollection(["src"]);
    seedFiles(driver, 1002);
    driver.failWhen((call, key) =>
      call === "delete" && key === "dav/src/f1001" ? "unavailable" : null,
    );
    await storage.move(["src"], ["dst"], { overwrite: true });
    driver.failWhen(null);
    await storage.write(["src", "late"], text("late"), {});
    await storage.move(["src"], ["dst"], { overwrite: true });
    const done = await snapshot(storage);
    expect(done["dst/late"]).toBe("late");
    expect(fileCount(done, "dst")).toBe(1002);
  });

  it("replaces the destination as usual when the source records another move", async () => {
    const { driver, storage } = make();
    await storage.createCollection(["src"]);
    seedFiles(driver, 1002);
    driver.failWhen((call, key) =>
      call === "delete" && key === "dav/src/f1001" ? "unavailable" : null,
    );
    await storage.move(["src"], ["dst"], { overwrite: true });
    driver.failWhen(null);
    await storage.createCollection(["other"]);
    await storage.write(["other", "x"], text("x"), {});
    // A move to somewhere else replaces that destination; the record names dst, not other.
    await storage.move(["src"], ["other"], { overwrite: true });
    const done = await snapshot(storage);
    expect(done["other/x"]).toBeUndefined();
    // What was left of the source: the three files of the batch that failed.
    expect(fileCount(done, "other")).toBe(3);
    expect(fileCount(done, "dst")).toBe(1002);
  });

  it.each(["get", "patch", "moveTree", "removeTree"])(
    "loses nothing when the property store fails at %s, and a retry finishes",
    async (failing) => {
      const { driver, properties, storage } = make();
      await storage.createCollection(["src"]);
      seedFiles(driver, 3);
      properties.failWhen((call) => call === failing);
      const first = await storage.move(["src"], ["dst"], { overwrite: true });
      properties.failWhen(null);
      const tree = await snapshot(storage);
      for (let i = 0; i < 3; i += 1) {
        const name = `f000${i}`;
        expect([tree[`src/${name}`], tree[`dst/${name}`]]).toContain(`v${i}`);
      }
      if (!first.ok) await storage.move(["src"], ["dst"], { overwrite: true });
      const done = await snapshot(storage);
      expect(fileCount(done, "dst")).toBe(3);
      expect(Object.keys(done).some((key) => key.startsWith("src"))).toBe(false);
    },
  );
});

const stopped = async () => {
  const made = make();
  await made.storage.createCollection(["src"]);
  seedFiles(made.driver, 1002);
  await made.storage.patchProperties(
    ["src"],
    [{ name: "{urn:x}tag", xml: '<x:tag xmlns:x="urn:x"/>' }],
    [],
  );
  made.driver.failWhen((call, key) =>
    call === "delete" && key === "dav/src/f1001" ? "unavailable" : null,
  );
  await made.storage.move(["src"], ["dst"], { overwrite: true });
  made.driver.failWhen(null);
  return made;
};

describe("the record of a move", () => {
  it("is not among the properties a client reads", async () => {
    const { storage } = await stopped();
    const read = await storage.properties([["src"], ["dst"]]);
    expect(read).toEqual({
      ok: true,
      value: { src: [], dst: [{ name: "{urn:x}tag", xml: '<x:tag xmlns:x="urn:x"/>' }] },
    });
  });

  it("cannot be set or removed by a client", async () => {
    const { storage } = await stopped();
    const internal = "{urn:davloom:internal}move-to";
    expect(await storage.patchProperties(["src"], [], [internal])).toEqual({
      ok: true,
      value: null,
    });
    expect(
      await storage.patchProperties(
        ["dst"],
        [{ name: internal, xml: '<move-to xmlns="urn:davloom:internal">x</move-to>' }],
        [],
      ),
    ).toEqual({ ok: true, value: null });
    // The record survived the attempt to remove it: the retry still resumes.
    await storage.move(["src"], ["dst"], { overwrite: true });
    expect(fileCount(await snapshot(storage), "dst")).toBe(1002);
  });

  it("does not travel with a copy of the source", async () => {
    const { storage } = await stopped();
    await storage.copy(["src"], ["copy"], { overwrite: false, shallow: false });
    // A move of the copy to dst replaces dst: the copy carries no record of the earlier move. The
    // copy holds the three files left in the source, so dst ends with three, not 1,002.
    await storage.move(["copy"], ["dst"], { overwrite: true });
    expect(fileCount(await snapshot(storage), "dst")).toBe(3);
  });
});

const limitTree = async (storage: StorageBackend, files: number) => {
  await storage.createCollection(["src"]);
  for (let i = 0; i < files; i += 1) await storage.write(["src", `f000${i}`], text(`v${i}`), {});
};

describe("the synchronous limit", () => {
  it.each([
    ["copy", (s: StorageBackend) => s.copy(["src"], ["dst"], { overwrite: false, shallow: false })],
    ["move", (s: StorageBackend) => s.move(["src"], ["dst"], { overwrite: false })],
  ] as const)("refuses a %s over the limit and changes nothing", async (_, run) => {
    // The collection's marker and four files: five objects, over a limit of four.
    const { storage } = make(4);
    await limitTree(storage, 4);
    const before = await snapshot(storage);
    expect(await run(storage)).toEqual(failed("too-many"));
    expect(await snapshot(storage)).toEqual(before);
  });

  it.each([
    ["copy", (s: StorageBackend) => s.copy(["src"], ["dst"], { overwrite: false, shallow: false })],
    ["move", (s: StorageBackend) => s.move(["src"], ["dst"], { overwrite: false })],
    [
      "shallow copy",
      (s: StorageBackend) => s.copy(["src"], ["dst"], { overwrite: false, shallow: true }),
    ],
  ] as const)("allows a %s at the limit", async (_, run) => {
    const { storage } = make(5);
    await limitTree(storage, 4);
    expect((await run(storage)).ok).toBe(true);
  });

  it("allows a shallow copy of any collection, and any single file", async () => {
    const { storage } = make(1);
    await limitTree(storage, 4);
    expect((await storage.copy(["src"], ["dst"], { overwrite: false, shallow: true })).ok).toBe(
      true,
    );
    expect((await storage.move(["src", "f0000"], ["one"], { overwrite: false })).ok).toBe(true);
  });
});

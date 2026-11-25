import { createMemoryStorage } from "@davloom/core";
import { describe, expect, it } from "vitest";
import {
  BASE,
  buildWorld,
  COLLECTIONS,
  FILES,
  refusingBackend,
  snapshot,
  snapshotAll,
  unavailableBackend,
  under,
} from "./world";

// The world the table tests run against (world.ts): what it holds, how a snapshot reads it, and
// the backends that stand in for a store that is down and one that refuses names as RustFS does.

/** A body that records whether it was cancelled. */
const body = () => {
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    cancel: () => {
      state.cancelled = true;
    },
  });
  return { state, stream };
};

describe("the table world", () => {
  it("holds these files and collections", async () => {
    const world = await buildWorld({ scope: null });
    expect(await snapshotAll(world)).toEqual({
      "files/photos/": "collection []",
      "files/photos/a.jpg": "file photo-a-content []",
      "files/photos/sub/": "collection []",
      "files/photos/sub/b.jpg": "file photo-b-content []",
      "files/docs/": "collection []",
      "files/docs/secret.txt": "file top-secret-content []",
      "files/photos2/": "collection []",
      "files/photos2/z.txt": "file neighbour-content []",
      "media/music/": "collection []",
      "media/music/c.mp3": "file music-c-content []",
    });
    expect(Object.keys(FILES)).toHaveLength(5);
    expect(COLLECTIONS).toEqual([
      "files/photos",
      "files/photos/sub",
      "files/docs",
      "files/photos2",
      "media/music",
    ]);
    expect(BASE).toBe("/dav");
  });

  it("dates both Mounts' entries on 1 November 2026", async () => {
    const world = await buildWorld({ scope: null });
    for (const path of ["/files/photos/a.jpg", "/media/music/c.mp3"]) {
      const response = await world.call("HEAD", path);
      expect(response.headers.get("last-modified")).toBe("Sun, 01 Nov 2026 00:00:00 GMT");
    }
  });

  it("snapshots content, kinds and dead properties, collections with a slash", async () => {
    const storage = createMemoryStorage({ now: () => 0 });
    await storage.createCollection(["c"]);
    await storage.write(["c", "f.txt"], new Blob(["text"]).stream(), {});
    await storage.patchProperties(["c"], [{ name: "{urn:z}p", xml: '<Z:p xmlns:Z="urn:z"/>' }], []);
    expect(await snapshot(storage, "pre")).toEqual({
      "pre/c/": 'collection [{"name":"{urn:z}p","xml":"<Z:p xmlns:Z=\\"urn:z\\"/>"}]',
      "pre/c/f.txt": "file text []",
    });
    expect(await snapshot(unavailableBackend(), "pre")).toEqual({});
  });

  it.each([
    ["files/photos", "files/photos", true],
    ["files/photos/", "files/photos", true],
    ["files/photos/a.jpg", "files/photos", true],
    ["files/photos2/", "files/photos", false],
    ["files/", "files/photos", false],
    ["xfiles/photos/a", "files/photos", false],
  ] as const)("%s lies under %s: %s", (key, root, expected) => {
    expect(under(key, root)).toBe(expected);
  });

  it("stands in for a backend that is down, and cancels a body it is sent", async () => {
    const backend = unavailableBackend();
    const { state, stream } = body();
    expect(await backend.write(["x"], stream, {})).toEqual({ ok: false, failure: "unavailable" });
    expect(state.cancelled).toBe(true);
    expect(await backend.write(["x"], null, {})).toEqual({ ok: false, failure: "unavailable" });
    expect(await backend.stat(["x"])).toEqual({ ok: false, failure: "unavailable" });
  });
});

const refusing = async () => {
  const inner = createMemoryStorage({ now: () => 0 });
  await inner.createCollection(["c"]);
  await inner.write(["c", "bad-file"], new Blob(["old"]).stream(), {});
  await inner.write(["c", "ok"], new Blob(["ok"]).stream(), {});
  const backend = refusingBackend(inner, (names, kind) =>
    names.some((name) => name.startsWith("bad") || (kind === "collection" && name === "dir")),
  );
  return { inner, backend };
};

describe("a backend that refuses names", () => {
  it("refuses to create a refused file, and cancels its body", async () => {
    const { backend } = await refusing();
    const { state, stream } = body();
    expect(await backend.write(["c", "bad"], stream, {})).toEqual({
      ok: false,
      failure: "name-refused",
    });
    expect(state.cancelled).toBe(true);
    expect(await backend.write(["c", "bad2"], null, {})).toEqual({
      ok: false,
      failure: "name-refused",
    });
    expect((await backend.stat(["c", "bad"])).ok).toBe(false);
  });

  it("checks the rest first: a missing parent, an existing entry, and the root", async () => {
    const { backend } = await refusing();
    expect(await backend.write(["nope", "bad"], null, {})).toEqual({
      ok: false,
      failure: "no-parent",
    });
    // An entry that exists is written over, not created.
    expect((await backend.write(["c", "bad-file"], new Blob(["new"]).stream(), {})).ok).toBe(true);
    expect((await backend.createCollection(["c", "ok", "bad"])).ok).toBe(false);
    expect(await backend.createCollection(["c", "ok", "bad"])).not.toEqual({
      ok: false,
      failure: "name-refused",
    });
  });

  it("refuses a collection by the kind it would create", async () => {
    const { backend } = await refusing();
    expect(await backend.createCollection(["c", "dir"])).toEqual({
      ok: false,
      failure: "name-refused",
    });
    expect((await backend.write(["c", "dir"], new Blob(["f"]).stream(), {})).ok).toBe(true);
  });

  it("refuses a copy or move that would create a refused name, and nothing else", async () => {
    const { backend, inner } = await refusing();
    const options = { overwrite: true, shallow: false };
    expect(await backend.copy(["c", "ok"], ["c", "bad"], options)).toEqual({
      ok: false,
      failure: "name-refused",
    });
    expect(await backend.move(["c", "ok"], ["c", "bad"], { overwrite: true })).toEqual({
      ok: false,
      failure: "name-refused",
    });
    // A file copied to a name refused only for collections is kept.
    expect((await backend.copy(["c", "ok"], ["c", "dir"], options)).ok).toBe(true);
    expect((await backend.move(["c", "missing"], ["c", "bad"], { overwrite: true })).ok).toBe(
      false,
    );
    expect(await backend.move(["c", "missing"], ["c", "bad"], { overwrite: true })).not.toEqual({
      ok: false,
      failure: "name-refused",
    });
    expect((await backend.move(["c", "ok"], ["c", "fine"], { overwrite: true })).ok).toBe(true);
    expect(Object.keys(await snapshot(inner, ""))).toEqual([
      "/c/",
      "/c/bad-file",
      "/c/dir",
      "/c/fine",
    ]);
  });
});

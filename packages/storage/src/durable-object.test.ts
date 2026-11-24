import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { durableObjectSuite } from "../test/durable-object-suite";
import { localNamespace, sqliteObjectState, type SqliteEngine } from "../test/sqlite-object";
import { FullStorageObject } from "../test/worker";
import { CHUNK_BYTES, durableObjectStorage, StorageObject } from "./durable-object";

// The Durable Objects adapter on Bun, on bun:sqlite, with the cases it passes in workerd
// (test/durable-object.test.ts). This package's types are the Workers ones, which have no bun:sqlite,
// so the module is loaded by a name the type checker does not resolve.
const BUN_SQLITE = "bun:sqlite";
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:sqlite's Database has this shape
const { Database } = (await import(BUN_SQLITE)) as {
  Database: new (path: string) => SqliteEngine;
};
const engine = () => new Database(":memory:");
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the unit tests' stand-in env
const env = {} as Cloudflare.Env;

const storage = localNamespace((state) => new StorageObject(state, env), engine);
const full = localNamespace((state) => new FullStorageObject(state, env), engine);

durableObjectSuite("Bun", { storage, full, runs: 60 });

const streamOf = (text: string) => new Blob([text]).stream();

/** The usage counted from the entry rows, as `usage` did before it kept totals. */
const counted = (database: SqliteEngine) =>
  database
    .query(
      "SELECT COALESCE(SUM(kind = 0), 0) AS files, COALESCE(SUM(kind = 1), 0) AS collections, COALESCE(SUM(size), 0) AS bytes FROM entries",
    )
    .all()[0];

describe("the Durable Objects adapter on its SQLite rows", () => {
  it("drops the chunks a write left pending when the object starts again", async () => {
    const database = engine();
    const first = new StorageObject(sqliteObjectState(database), env);
    await first.write(["kept"], streamOf("kept"), {});
    database.exec("INSERT INTO pending (content) VALUES (99)");
    database.exec("INSERT INTO chunks (content, position, data) VALUES (99, 0, x'00')");
    const restarted = new StorageObject(sqliteObjectState(database), env);
    await Promise.resolve();
    expect(database.query("SELECT content FROM chunks ORDER BY content").all()).toEqual([
      { content: 1 },
    ]);
    expect(restarted.stat(["kept"]).ok).toBe(true);
    expect(database.query("SELECT content FROM pending").all()).toEqual([]);
  });

  it.each([
    ["a body longer than its size", "abcdef", 3],
    ["a body shorter than its size", "ab", 3],
  ])("refuses %s and keeps no chunk of it", async (_, text, size) => {
    const database = engine();
    const object = new StorageObject(sqliteObjectState(database), env);
    expect(await object.write(["f"], streamOf(text), { size })).toEqual({
      ok: false,
      failure: "size-mismatch",
    });
    expect(database.query("SELECT COUNT(*) AS n FROM chunks").all()).toEqual([{ n: 0 }]);
    expect(database.query("SELECT COUNT(*) AS n FROM pending").all()).toEqual([{ n: 0 }]);
  });

  it("answers size-mismatch when the body fails while it arrives", async () => {
    const object = new StorageObject(sqliteObjectState(engine()), env);
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.error(new Error("connection reset")),
    });
    expect(await object.write(["f"], body, {})).toEqual({ ok: false, failure: "size-mismatch" });
    expect(object.stat(["f"])).toEqual({ ok: false, failure: "not-found" });
  });

  it("refuses a create-only write when the file appeared while the body arrived", async () => {
    const object = new StorageObject(sqliteObjectState(engine()), env);
    let release: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) =>
        new Promise<void>((done) => {
          release = () => {
            controller.enqueue(new TextEncoder().encode("late"));
            controller.close();
            done();
          };
        }),
    });
    const late = object.write(["f"], body, { ifAbsent: true });
    await object.write(["f"], streamOf("first"), {});
    release?.();
    expect(await late).toEqual({ ok: false, failure: "exists" });
  });

  it("fails a read whose file is replaced between two chunks", async () => {
    const object = new StorageObject(sqliteObjectState(engine()), env);
    await object.write(["f"], new Blob([new Uint8Array(CHUNK_BYTES + 1)]).stream(), {});
    const read = object.read(["f"]);
    if (!read.ok) throw new Error("the file did not open");
    // The stream holds the first chunk as soon as it exists, and fetches the second on demand.
    const reader = read.value.body.getReader();
    await object.write(["f"], streamOf("new"), {});
    expect((await reader.read()).value?.length).toBe(CHUNK_BYTES);
    await expect(reader.read()).rejects.toThrow("the file changed while it was read");
  });

  it.each([
    ["the root", [], "is-collection"],
    ["a collection", ["d"], "is-collection"],
    ["a missing file", ["missing"], "not-found"],
  ])("does not read %s", async (_, path, failure) => {
    const object = new StorageObject(sqliteObjectState(engine()), env);
    object.createCollection(["d"]);
    expect(object.read(path)).toEqual({ ok: false, failure });
  });

  it("gives the dead properties of the paths that exist, sorted by name", async () => {
    const object = new StorageObject(sqliteObjectState(engine()), env);
    await object.write(["f"], streamOf("x"), {});
    const b = { name: "{urn:t}b", xml: '<b xmlns="urn:t"/>' };
    const a = { name: "{urn:t}a", xml: '<a xmlns="urn:t"/>' };
    expect(object.patchProperties(["f"], [b, a], [])).toEqual({ ok: true, value: null });
    expect(object.patchProperties(["f"], [], ["{urn:t}b"])).toEqual({ ok: true, value: null });
    expect(object.patchProperties(["missing"], [a], [])).toEqual({
      ok: false,
      failure: "not-found",
    });
    expect(object.properties([["f"], ["missing"], []])).toEqual({
      ok: true,
      value: { f: [a], "": [] },
    });
  });

  it("counts files, collections and bytes", async () => {
    const object = new StorageObject(sqliteObjectState(engine()), env);
    expect(object.usage()).toEqual({ ok: true, value: { files: 0, collections: 0, bytes: 0 } });
    object.createCollection(["d"]);
    await object.write(["d", "f"], streamOf("12345"), {});
    expect(object.usage()).toEqual({ ok: true, value: { files: 1, collections: 1, bytes: 5 } });
  });

  it("counts the entries of an object made before it kept totals, once, when it starts", async () => {
    const database = engine();
    const first = new StorageObject(sqliteObjectState(database), env);
    first.createCollection(["d"]);
    await first.write(["d", "f"], streamOf("12345"), {});
    await first.write(["g"], streamOf("ab"), {});
    // The schema of 2026-11-23 had no totals.
    database.exec("DROP TABLE totals");
    const restarted = new StorageObject(sqliteObjectState(database), env);
    await Promise.resolve();
    expect(restarted.usage()).toEqual({
      ok: true,
      value: { files: 2, collections: 1, bytes: 7 },
    });
    // A later start keeps the totals rather than count again.
    database.exec("UPDATE totals SET files = 40 WHERE id = 0");
    const again = new StorageObject(sqliteObjectState(database), env);
    await Promise.resolve();
    expect(again.usage()).toMatchObject({ ok: true, value: { files: 40 } });
  });

  it("keeps the totals in one row, whatever the object holds", async () => {
    const database = engine();
    const object = new StorageObject(sqliteObjectState(database), env);
    for (let index = 0; index < 30; index += 1)
      await object.write([`f${index}`], streamOf("x"), {});
    expect(database.query("SELECT COUNT(*) AS n FROM totals").all()).toEqual([{ n: 1 }]);
    expect(object.quota()).toMatchObject({ ok: true, value: { used: 30 } });
  });

  it("takes a removed file off the totals when the object is full", async () => {
    const database = engine();
    const object = new FullStorageObject(sqliteObjectState(database), env);
    object.createCollection(["d"]);
    await object.write(["d", "f"], streamOf("xyz"), {});
    object.setFull(true);
    expect(object.remove(["d"])).toEqual({ ok: true, value: null });
    expect(object.usage()).toEqual({ ok: true, value: counted(database) });
    expect(object.usage()).toEqual({ ok: true, value: { files: 0, collections: 0, bytes: 0 } });
  });

  it("keeps the totals equal to a count of the entry rows on random operations", async () => {
    const name = fc.constantFrom("a", "b", "c");
    const path = fc.array(name, { minLength: 1, maxLength: 3 });
    const op = fc.oneof(
      fc.record({ kind: fc.constant("write" as const), path, size: fc.nat({ max: 9 }) }),
      fc.record({ kind: fc.constant("mismatch" as const), path, size: fc.nat({ max: 9 }) }),
      fc.record({ kind: fc.constant("mkcol" as const), path }),
      fc.record({ kind: fc.constant("remove" as const), path }),
      fc.record({
        kind: fc.constant("copy" as const),
        from: path,
        to: path,
        overwrite: fc.boolean(),
        shallow: fc.boolean(),
      }),
      fc.record({
        kind: fc.constant("move" as const),
        from: path,
        to: path,
        overwrite: fc.boolean(),
      }),
      fc.record({ kind: fc.constant("full" as const), full: fc.boolean() }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 20 }), async (ops) => {
        const database = engine();
        const object = new FullStorageObject(sqliteObjectState(database), env);
        for (const step of ops) {
          if (step.kind === "write")
            await object.write(step.path, streamOf("x".repeat(step.size)), { size: step.size });
          else if (step.kind === "mismatch")
            await object.write(step.path, streamOf("x".repeat(step.size + 1)), {
              size: step.size,
            });
          else if (step.kind === "mkcol") object.createCollection(step.path);
          else if (step.kind === "remove") object.remove(step.path);
          else if (step.kind === "copy")
            object.copy(step.from, step.to, { overwrite: step.overwrite, shallow: step.shallow });
          else if (step.kind === "move")
            object.move(step.from, step.to, { overwrite: step.overwrite });
          else object.setFull(step.full);
          expect(object.usage(), JSON.stringify(step)).toEqual({
            ok: true,
            value: counted(database),
          });
        }
      }),
      { numRuns: 200 },
    );
  });

  it("keeps a removal when the parent's time cannot be written", async () => {
    const object = new FullStorageObject(sqliteObjectState(engine()), env);
    object.createCollection(["d"]);
    await object.write(["d", "f"], streamOf("x"), {});
    object.setFull(true);
    expect(object.remove(["d", "f"])).toEqual({ ok: true, value: null });
    expect(object.stat(["d", "f"])).toEqual({ ok: false, failure: "not-found" });
  });

  it("answers insufficient-storage when a chunk does not fit", async () => {
    const object = new (class extends StorageObject {
      protected override insertOrUpdate(query: string, bindings: SqlStorageValue[]): void {
        if (query.startsWith("INSERT INTO chunks")) {
          throw new Error("SQLITE_FULL: database or disk is full");
        }
        super.insertOrUpdate(query, bindings);
      }
    })(sqliteObjectState(engine()), env);
    expect(await object.write(["f"], streamOf("x"), {})).toEqual({
      ok: false,
      failure: "insufficient-storage",
    });
  });

  it("rethrows an error that is not a full object", async () => {
    const object = new (class extends StorageObject {
      protected override insertOrUpdate(): void {
        throw new Error("disk I/O error");
      }
    })(sqliteObjectState(engine()), env);
    expect(() => object.createCollection(["d"])).toThrow("disk I/O error");
    await expect(object.write(["f"], streamOf("x"), {})).rejects.toThrow("disk I/O error");
  });

  it("names the root's ETag by its last change", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(36 * 36);
    try {
      const object = new StorageObject(sqliteObjectState(engine()), env);
      expect(object.stat([])).toMatchObject({ ok: true, value: { etag: "r0", modified: 0 } });
      object.createCollection(["d"]);
      expect(object.stat([])).toMatchObject({ ok: true, value: { etag: "r100", modified: 1296 } });
    } finally {
      now.mockRestore();
    }
  });

  it("reaches one object per backend through the namespace", async () => {
    const backend = durableObjectStorage(storage, "shared");
    await backend.write(["f"], streamOf("one"), {});
    const again = durableObjectStorage(storage, "shared");
    expect((await again.stat(["f"])).ok).toBe(true);
    expect((await durableObjectStorage(storage, "other").stat(["f"])).ok).toBe(false);
  });
});

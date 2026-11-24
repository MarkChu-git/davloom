import { Database } from "bun:sqlite";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "@davloom/database/bun-sqlite";
import { createRepositories } from "@davloom/database/repositories";
import type { Lock } from "@davloom/webdav";
import { beforeEach, describe, expect, it } from "vitest";
import { createSqlLockStore } from "./locks";

// The WebDAV LockStore on dav_locks, in an in-memory Bun SQLite database.

const NOW = 1_000_000;
let store: ReturnType<typeof createSqlLockStore>;

beforeEach(() => {
  const db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  store = createSqlLockStore(createRepositories(db).locks);
});

const lock = (token: string, root: string[], overrides: Partial<Lock> = {}): Lock => ({
  token,
  root,
  depth: "infinity",
  scope: "exclusive",
  owner: "<o/>",
  timeout: 60,
  expires: NOW + 60_000,
  ...overrides,
});

const tokens = async (path: string[], descendants: boolean) =>
  (await store.covering(path, { descendants, now: NOW })).map((l) => l.token).toSorted();

describe("the SQL lock store", () => {
  it("finds the locks that cover a path, and those under it when asked", async () => {
    expect(await store.create(lock("deep", ["a"]), NOW)).toBe(true);
    expect(await store.create(lock("zero", ["b"], { depth: "0", scope: "shared" }), NOW)).toBe(
      true,
    );
    expect(await store.create(lock("child", ["b", "c"], { depth: "0" }), NOW)).toBe(true);
    expect(await tokens(["a", "x", "y"], false)).toEqual(["deep"]);
    expect(await tokens(["b", "c"], false)).toEqual(["child"]);
    expect(await tokens(["b"], false)).toEqual(["zero"]);
    expect(await tokens(["b"], true)).toEqual(["child", "zero"]);
    expect(await tokens([], true)).toEqual(["child", "deep", "zero"]);
  });

  it("reads back what it stored", async () => {
    await store.create(lock("t", ["a", "b"], { depth: "0", scope: "shared" }), NOW);
    expect(await store.covering(["a", "b"], { descendants: false, now: NOW })).toEqual([
      lock("t", ["a", "b"], { depth: "0", scope: "shared" }),
    ]);
  });

  it("refuses a lock that conflicts with one held above it", async () => {
    await store.create(lock("above", ["a"]), NOW);
    expect(await store.create(lock("below", ["a", "b"]), NOW)).toBe(false);
  });

  it("refreshes a lock it holds, and nothing it does not", async () => {
    await store.create(lock("t", []), NOW);
    expect((await store.refresh("t", 120, NOW + 120_000, NOW))?.timeout).toBe(120);
    expect(await store.refresh("gone", 120, NOW + 120_000, NOW)).toBeNull();
  });

  it("removes one lock, or every lock of a tree", async () => {
    await store.create(lock("a", ["a"]), NOW);
    await store.create(lock("ab", ["x", "b"], { depth: "0" }), NOW);
    expect(await store.remove("a")).toBe(true);
    expect(await store.remove("a")).toBe(false);
    await store.removeTree(["x"]);
    expect(await tokens([], true)).toEqual([]);
  });

  it("ignores expired locks", async () => {
    await store.create(lock("old", ["a"], { expires: NOW - 1 }), NOW - 10);
    expect(await tokens(["a"], false)).toEqual([]);
  });
});

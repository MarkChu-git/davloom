import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "./bun-sqlite";
import { createRepositories, isUniqueViolation, type LockRecord } from "./repositories";
import * as schema from "./schema";

// The repositories against a migrated in-memory Bun SQLite database, the same queries D1 runs.

type Db = ReturnType<typeof createBunSqliteDatabase>;

const T0 = new Date("2026-01-01T00:00:00.000Z");
const NOW = 1_000_000;

let db: Db;
let repositories: ReturnType<typeof createRepositories>;

beforeEach(() => {
  db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  repositories = createRepositories(db);
});

const insertBackend = async (id: string, name: string, kind: string, createdAt: Date) => {
  await db
    .insert(schema.storageBackends)
    .values({ id, name, kind, config: {}, createdAt, updatedAt: createdAt });
};

const insertKey = async (row: Partial<typeof schema.apikey.$inferInsert> & { id: string }) => {
  await db.insert(schema.apikey).values({
    key: `hash-${row.id}`,
    referenceId: "user-1",
    createdAt: T0,
    updatedAt: T0,
    ...row,
  });
};

const lock = (token: string, root: string, expiresAt = NOW + 1000): LockRecord => ({
  token,
  root,
  depth: "infinity",
  scope: "exclusive",
  owner: "<owner/>",
  timeout: 1000,
  expiresAt,
});

const createLocks = async (roots: readonly string[]) => {
  for (const [index, root] of roots.entries()) {
    await repositories.locks.create(lock(`t${index}`, root));
  }
};

const sorted = (values: readonly string[]) =>
  values.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const foundRoots = async (roots: readonly string[], under: string | null, now = NOW) =>
  sorted((await repositories.locks.find(roots, under, now)).map((found) => found.root));

const errorOf = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to fail");
};

describe("users", () => {
  it("counts the users", async () => {
    expect(await repositories.users.count()).toBe(0);

    for (const id of ["u1", "u2"]) {
      await db
        .insert(schema.user)
        .values({ id, name: id, email: `${id}@davloom.test`, createdAt: T0, updatedAt: T0 });
    }

    expect(await repositories.users.count()).toBe(2);
  });
});

describe("backends", () => {
  it("lists backends oldest first", async () => {
    await insertBackend("b-2", "Second", "s3", new Date(T0.getTime() + 2));
    await insertBackend("b-1", "First", "durable-object", T0);

    expect(await repositories.backends.list()).toEqual([
      { id: "b-1", name: "First", kind: "durable-object", createdAt: T0 },
      { id: "b-2", name: "Second", kind: "s3", createdAt: new Date(T0.getTime() + 2) },
    ]);
  });

  it("creates a backend with its config", async () => {
    const before = Date.now();
    await repositories.backends.create({
      id: "b-1",
      name: "Default",
      kind: "s3",
      config: { a: 1 },
    });

    const [row] = await db.select().from(schema.storageBackends);
    expect(row).toMatchObject({ id: "b-1", name: "Default", kind: "s3", config: { a: 1 } });
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row?.updatedAt).toEqual(row?.createdAt);
  });

  it("refuses a second backend with the same name as a unique violation", async () => {
    await repositories.backends.create({ id: "b-1", name: "Default", kind: "s3", config: {} });

    const error = await errorOf(() =>
      repositories.backends.create({ id: "b-2", name: "Default", kind: "s3", config: {} }),
    );

    expect(isUniqueViolation(error)).toBe(true);
  });
});

describe("mounts", () => {
  beforeEach(async () => {
    await insertBackend("b-1", "One", "durable-object", T0);
    await insertBackend("b-2", "Two", "s3", T0);
  });

  it("lists Mounts by name with their backend's kind", async () => {
    await repositories.mounts.create({ id: "m-1", name: "photos", backendId: "b-2", root: "a/b" });
    await repositories.mounts.create({ id: "m-2", name: "files", backendId: "b-1", root: "" });

    const mounts = await repositories.mounts.list();

    expect(mounts).toEqual([
      {
        id: "m-2",
        name: "files",
        backendId: "b-1",
        backendKind: "durable-object",
        root: "",
        createdAt: expect.any(Date),
      },
      {
        id: "m-1",
        name: "photos",
        backendId: "b-2",
        backendKind: "s3",
        root: "a/b",
        createdAt: expect.any(Date),
      },
    ]);
  });

  it("renames a known Mount and reports an unknown one", async () => {
    await repositories.mounts.create({ id: "m-1", name: "files", backendId: "b-1", root: "" });

    expect(await repositories.mounts.rename("m-1", "archive")).toBe(true);
    expect(await repositories.mounts.rename("m-9", "other")).toBe(false);
    expect((await repositories.mounts.list()).map((mount) => mount.name)).toEqual(["archive"]);
  });

  it("removes a known Mount and reports an unknown one", async () => {
    await repositories.mounts.create({ id: "m-1", name: "files", backendId: "b-1", root: "" });

    expect(await repositories.mounts.remove("m-9")).toBe(false);
    expect(await repositories.mounts.remove("m-1")).toBe(true);
    expect(await repositories.mounts.remove("m-1")).toBe(false);
    expect(await repositories.mounts.list()).toEqual([]);
  });

  it.each([
    [
      "creating",
      () => repositories.mounts.create({ id: "m-3", name: "files", backendId: "b-2", root: "" }),
    ],
    ["renaming", () => repositories.mounts.rename("m-2", "files")],
  ])("%s a Mount onto a taken name is a unique violation", async (_case, run) => {
    await repositories.mounts.create({ id: "m-1", name: "files", backendId: "b-1", root: "" });
    await repositories.mounts.create({ id: "m-2", name: "photos", backendId: "b-1", root: "" });

    expect(isUniqueViolation(await errorOf(run))).toBe(true);
  });
});

describe("apiKeys", () => {
  it("finds a key by its stored hash", async () => {
    const expiresAt = new Date(T0.getTime() + 86_400_000);
    await insertKey({
      id: "k-1",
      key: "hash-one",
      name: "Laptop",
      start: "dav_abcdef",
      enabled: false,
      expiresAt,
      metadata: '{"access":"read-write"}',
    });

    expect(await repositories.apiKeys.findByHash("hash-one")).toEqual({
      id: "k-1",
      name: "Laptop",
      start: "dav_abcdef",
      enabled: false,
      expiresAt,
      createdAt: T0,
      metadata: { access: "read-write" },
    });
    expect(await repositories.apiKeys.findByHash("hash-two")).toBeNull();
    expect(await repositories.apiKeys.findByHash("k-1")).toBeNull();
  });

  it("treats a key with no enabled flag as enabled", async () => {
    await insertKey({ id: "k-1", enabled: null });

    expect(await repositories.apiKeys.findByHash("hash-k-1")).toMatchObject({
      enabled: true,
      name: null,
      start: null,
      expiresAt: null,
    });
  });

  it.each([
    ["a JSON object", '{"access":"read-only"}', { access: "read-only" }],
    ["a JSON array", "[1,2]", [1, 2]],
    [
      "JSON stringified twice",
      JSON.stringify(JSON.stringify({ access: "read-write" })),
      { access: "read-write" },
    ],
    ["a JSON string that is not JSON inside", '"read-write"', null],
    ["invalid JSON", "{access:", null],
    ["no metadata", null, null],
  ])("parses %s metadata", async (_case, metadata, expected) => {
    await insertKey({ id: "k-1", metadata });

    expect((await repositories.apiKeys.findByHash("hash-k-1"))?.metadata).toEqual(expected);
  });

  it("lists keys oldest first", async () => {
    await insertKey({ id: "k-2", createdAt: new Date(T0.getTime() + 5) });
    await insertKey({ id: "k-1" });

    expect((await repositories.apiKeys.list()).map((key) => key.id)).toEqual(["k-1", "k-2"]);
  });

  it("removes a known key and reports an unknown one", async () => {
    await insertKey({ id: "k-1" });

    expect(await repositories.apiKeys.remove("k-9")).toBe(false);
    expect(await repositories.apiKeys.remove("k-1")).toBe(true);
    expect(await repositories.apiKeys.list()).toEqual([]);
  });
});

describe("locks", () => {
  it("stores and returns a lock unchanged", async () => {
    const record = lock("t1", "a/b");
    await repositories.locks.create(record);

    expect(await repositories.locks.find(["a/b"], null, NOW)).toEqual([record]);
  });

  it.each([
    [["a"], null, ["a"]],
    [["a", "a/b"], null, ["a", "a/b"]],
    [["missing"], null, []],
    [[], null, []],
    [["a"], "a", ["a", "a/b", "a/b/c", "a/z"]],
    [[], "a", ["a/b", "a/b/c", "a/z"]],
    [["b"], "a", ["a/b", "a/b/c", "a/z", "b"]],
    [[], "a/b", ["a/b/c"]],
    [[], "", ["", "a", "a.b", "a/b", "a/b/c", "a/z", "a0", "ab", "b"]],
  ])("roots %j under %j find %j", async (roots, under, expected) => {
    await createLocks(["", "a", "a.b", "a/b", "a/b/c", "a/z", "a0", "ab", "b"]);

    expect(await foundRoots(roots, under)).toEqual(sorted(expected));
  });

  it.each([
    ["50%", ["50%/x", "50%/x/y"], ["50%", "50%x", "500", "50", "5"]],
    ["a_b", ["a_b/c"], ["axb/c", "a_bc", "a_b"]],
    ["dir%_", ["dir%_/f"], ["dirab/f", "dir%_x/f"]],
    ["é", ["é/x", "é/日本"], ["éa", "e/x", "é0"]],
    ["日本", ["日本/語"], ["日本語", "日/本"]],
    ["🔑", ["🔑/a", "🔑/🔑"], ["🔑🔑", "🔑a", "🔐/a"]],
    ["a", ["a/🔑", "a/é", "a/\u{10FFFF}"], ["a🔑", "aé"]],
  ])("under %j finds only the roots inside it", async (under, inside, outside) => {
    await createLocks([...inside, ...outside]);

    expect(await foundRoots([], under)).toEqual(sorted(inside));
  });

  it("finds only locks that expire after now", async () => {
    await repositories.locks.create(lock("past", "a", NOW - 1));
    await repositories.locks.create(lock("now", "a/b", NOW));
    await repositories.locks.create(lock("future", "a/c", NOW + 1));

    const found = await repositories.locks.find(["a"], "a", NOW);

    expect(found.map((record) => record.token)).toEqual(["future"]);
  });

  it("refreshes a live lock and returns it", async () => {
    await repositories.locks.create(lock("t1", "a", NOW + 10));

    expect(await repositories.locks.refresh("t1", 600, NOW + 600_000, NOW)).toEqual({
      ...lock("t1", "a"),
      timeout: 600,
      expiresAt: NOW + 600_000,
    });
    expect((await repositories.locks.find(["a"], null, NOW + 500_000)).length).toBe(1);
  });

  it.each([
    ["an expired lock", "t1", NOW - 1],
    ["a lock expiring now", "t1", NOW],
    ["an unknown token", "t9", NOW + 10],
  ])("does not refresh %s", async (_case, token, expiresAt) => {
    await repositories.locks.create(lock("t1", "a", expiresAt));

    expect(await repositories.locks.refresh(token, 600, NOW + 600_000, NOW)).toBeNull();
    const [row] = await db.select().from(schema.davLocks);
    expect(row?.expiresAt).toBe(expiresAt);
  });

  it("removes a lock by token", async () => {
    await createLocks(["a", "b"]);

    expect(await repositories.locks.remove("t9")).toBe(false);
    expect(await repositories.locks.remove("t0")).toBe(true);
    expect(await foundRoots([], "")).toEqual(["b"]);
  });

  it.each([
    ["a", ["", "a.b", "a0", "ab", "b", "b/a"]],
    ["a/b", ["", "a", "a.b", "a/z", "a0", "ab", "b", "b/a"]],
    ["missing", ["", "a", "a.b", "a/b", "a/b/c", "a/z", "a0", "ab", "b", "b/a"]],
    ["", []],
  ])("removing the tree at %j leaves %j", async (root, left) => {
    await createLocks(["", "a", "a.b", "a/b", "a/b/c", "a/z", "a0", "ab", "b", "b/a"]);

    await repositories.locks.removeTree(root);

    expect(await foundRoots([], "")).toEqual(sorted(left));
  });

  it("removes a tree under a name with LIKE wildcards only", async () => {
    await createLocks(["50%", "50%/x", "500/x", "5/x"]);

    await repositories.locks.removeTree("50%");

    expect(await foundRoots([], "")).toEqual(["5/x", "500/x"]);
  });

  it("purges the locks that expired by now", async () => {
    await repositories.locks.create(lock("past", "a", NOW - 1));
    await repositories.locks.create(lock("now", "b", NOW));
    await repositories.locks.create(lock("future", "c", NOW + 1));

    await repositories.locks.purge(NOW);

    const rows = await db.select().from(schema.davLocks);
    expect(rows.map((row) => row.token)).toEqual(["future"]);
  });
});

describe("isUniqueViolation", () => {
  const unique = new Error("UNIQUE constraint failed: mounts.name");

  it.each([
    ["a unique constraint error", unique, true],
    ["the message in lower case", new Error("unique constraint failed: mounts.name"), true],
    [
      "a D1 error wrapping it",
      new Error("D1_ERROR: UNIQUE constraint failed: x.y: SQLITE_CONSTRAINT"),
      true,
    ],
    ["an error whose cause is one", new Error("Failed query", { cause: unique }), true],
    [
      "an error two causes deep",
      new Error("outer", { cause: new Error("middle", { cause: unique }) }),
      true,
    ],
    ["a foreign key error", new Error("FOREIGN KEY constraint failed"), false],
    ["a NOT NULL error", new Error("NOT NULL constraint failed: mounts.name"), false],
    [
      "an error with a string cause",
      new Error("outer", { cause: "UNIQUE constraint failed" }),
      false,
    ],
    ["a string", "UNIQUE constraint failed", false],
    ["a plain object", { message: "UNIQUE constraint failed" }, false],
    ["null", null, false],
    ["undefined", undefined, false],
  ])("%s is %s", (_case, error, expected) => {
    expect(isUniqueViolation(error)).toBe(expected);
  });
});

const record = (token: string, root: string, depth: string, scope: string) => ({
  token,
  root,
  depth,
  scope,
  owner: "",
  timeout: 60,
  expiresAt: 2_000,
});
const ancestorsOf = (root: string) => {
  const names = root === "" ? [] : root.split("/");
  return ["", ...names.slice(0, -1).map((_, i) => names.slice(0, i + 1).join("/"))].filter(
    (k) => k !== root,
  );
};

describe("locks.createIfFree", () => {
  it.each([
    // existing lock, new lock, stored?
    [["a", "0", "exclusive"], ["a", "0", "exclusive"], false],
    [["a", "0", "shared"], ["a", "0", "shared"], true],
    [["a", "0", "shared"], ["a", "0", "exclusive"], false],
    [["a", "0", "exclusive"], ["a/b", "0", "exclusive"], true],
    [["a", "infinity", "exclusive"], ["a/b", "0", "exclusive"], false],
    [["a", "infinity", "shared"], ["a/b", "0", "shared"], true],
    [["a/b", "0", "exclusive"], ["a", "0", "exclusive"], true],
    [["a/b", "0", "exclusive"], ["a", "infinity", "exclusive"], false],
    [["a/b", "0", "exclusive"], ["", "infinity", "exclusive"], false],
    [["", "infinity", "exclusive"], ["x/y", "0", "exclusive"], false],
    [["ab", "0", "exclusive"], ["a", "infinity", "exclusive"], true],
    [["a0", "0", "exclusive"], ["a", "infinity", "exclusive"], true],
    [["b", "infinity", "exclusive"], ["a", "infinity", "exclusive"], true],
  ] as const)("existing %j and new %j: stored %s", async (held, wanted, stored) => {
    await repositories.locks.create(record("held", held[0], held[1], held[2]));
    const wantedLock = record("new", wanted[0], wanted[1], wanted[2]);
    expect(
      await repositories.locks.createIfFree(wantedLock, ancestorsOf(wantedLock.root), 1_000),
    ).toBe(stored);
    const found = await repositories.locks.find([wantedLock.root], null, 1_000);
    expect(found.some((l) => l.token === "new")).toBe(stored);
  });

  it("an expired lock does not conflict", async () => {
    await repositories.locks.create({ ...record("held", "a", "0", "exclusive"), expiresAt: 500 });
    expect(
      await repositories.locks.createIfFree(record("new", "a", "0", "exclusive"), [""], 1_000),
    ).toBe(true);
  });
});

import { Database } from "bun:sqlite";
import { HOUR_MS, OPERATION_RETENTION_MS, type OperationErrorRecord } from "@davloom/core";
import { describe, expect, it } from "vitest";
import { bunSqliteAtomic, createBunSqliteDatabase, migrateBunSqliteDatabase } from "./bun-sqlite";
import { createOperationLog, createSettingsStore } from "./instance-data";
import { createRepositories } from "./repositories";

const fresh = () => {
  const db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  return db;
};

const NOW = Date.UTC(2026, 10, 24, 10, 30);
const THIS_HOUR = Date.UTC(2026, 10, 24, 10);

const error = (id: string, at: number): OperationErrorRecord => ({
  id,
  at,
  method: "MOVE",
  path: "/files/a",
  destination: "/files/b",
  status: 412,
});

describe("createSettingsStore", () => {
  it("reads nothing for an unset key, then the value saved last", async () => {
    const settings = createSettingsStore(fresh());
    expect(await settings.get("storage.defaultBackendId")).toBeUndefined();
    await settings.set("storage.defaultBackendId", "a");
    await settings.set("storage.defaultBackendId", "b");
    await settings.set("other", { nested: [1, 2] });
    expect(await settings.get("storage.defaultBackendId")).toBe("b");
    expect(await settings.get("other")).toEqual({ nested: [1, 2] });
  });
});

describe("createOperationLog", () => {
  it("adds each batch's counts to the hour's stored counts", async () => {
    const db = fresh();
    const log = createOperationLog(db, bunSqliteAtomic(db));
    await log.add({ hours: [{ hour: THIS_HOUR, operations: 3, failed: 1 }], errors: [] }, NOW);
    await log.add(
      {
        hours: [
          { hour: THIS_HOUR, operations: 2, failed: 2 },
          { hour: THIS_HOUR - HOUR_MS, operations: 9, failed: 0 },
        ],
        errors: [error("e1", NOW - 1000), error("e2", NOW - 500)],
      },
      NOW,
    );
    const read = await log.read(THIS_HOUR - HOUR_MS, 10);
    expect(read.hours).toEqual([
      { hour: THIS_HOUR - HOUR_MS, operations: 9, failed: 0 },
      { hour: THIS_HOUR, operations: 5, failed: 3 },
    ]);
    expect(read.errors.map((item) => item.id)).toEqual(["e2", "e1"]);
    expect(read.errors[0]).toEqual(error("e2", NOW - 500));
  });

  it("reads only from `since` on, at most the errors asked for", async () => {
    const db = fresh();
    const log = createOperationLog(db, bunSqliteAtomic(db));
    await log.add(
      {
        hours: [
          { hour: THIS_HOUR, operations: 1, failed: 0 },
          { hour: THIS_HOUR - 5 * HOUR_MS, operations: 1, failed: 0 },
        ],
        errors: [error("a", NOW - 3), error("b", NOW - 2), error("c", NOW - 1)],
      },
      NOW,
    );
    const read = await log.read(THIS_HOUR - HOUR_MS, 2);
    expect(read.hours).toHaveLength(1);
    expect(read.errors.map((item) => item.id)).toEqual(["c", "b"]);
  });

  it("removes what is older than the retention when it writes", async () => {
    const db = fresh();
    const log = createOperationLog(db, bunSqliteAtomic(db));
    const old = NOW - OPERATION_RETENTION_MS - HOUR_MS;
    await log.add(
      { hours: [{ hour: old, operations: 4, failed: 1 }], errors: [error("old", old)] },
      old,
    );
    await log.add({ hours: [{ hour: THIS_HOUR, operations: 1, failed: 0 }], errors: [] }, NOW);
    const read = await log.read(0, 10);
    expect(read.hours.map((hour) => hour.hour)).toEqual([THIS_HOUR]);
    expect(read.errors).toEqual([]);
  });

  it("keeps an error written twice once", async () => {
    const db = fresh();
    const log = createOperationLog(db, bunSqliteAtomic(db));
    const batch = {
      hours: [{ hour: THIS_HOUR, operations: 1, failed: 1 }],
      errors: [error("e", NOW)],
    };
    await log.add(batch, NOW);
    await log.add(batch, NOW);
    expect((await log.read(0, 10)).errors).toHaveLength(1);
  });
});

describe("backends.update and backends.remove", () => {
  it("changes and removes a backend, and tells an unknown id apart", async () => {
    const repositories = createRepositories(fresh());
    await repositories.backends.create({
      id: "b",
      name: "B",
      kind: "s3",
      config: { a: 1 },
      secretKey: "s",
    });
    expect(
      await repositories.backends.update("b", { name: "C", config: { a: 2 }, secretKey: null }),
    ).toBe(true);
    expect(await repositories.backends.list()).toMatchObject([
      { id: "b", name: "C", config: { a: 2 }, secretKey: null },
    ]);
    expect(
      await repositories.backends.update("x", { name: "C", config: {}, secretKey: null }),
    ).toBe(false);
    expect(await repositories.backends.remove("x")).toBe(false);
    expect(await repositories.backends.remove("b")).toBe(true);
    expect(await repositories.backends.list()).toEqual([]);
  });
});

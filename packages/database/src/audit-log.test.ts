import { Database } from "bun:sqlite";
import { AUDIT_RETENTION_MS, auditRecord, type AuditRecord } from "@davloom/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bunSqliteAtomic, createBunSqliteDatabase, migrateBunSqliteDatabase } from "./bun-sqlite";
import { createAuditLog } from "./instance-data";
import * as schema from "./schema";

// The Audit Log Port on the instance database (packages/core audit.ts).

const fresh = () => {
  const sqlite = new Database(":memory:");
  const db = createBunSqliteDatabase(sqlite);
  migrateBunSqliteDatabase(db);
  return { sqlite, db, log: createAuditLog(db, bunSqliteAtomic(db)) };
};

const NOW = Date.UTC(2026, 10, 24, 10, 30);

const event = (id: string, at: number, extra: Partial<AuditRecord> = {}): AuditRecord => ({
  ...auditRecord({ action: "key.create", target: id, address: "203.0.113.1" }, at, id),
  ...extra,
});

describe("createAuditLog", () => {
  it("keeps events with every field, newest first", async () => {
    const { log } = fresh();
    await log.add([event("a", NOW - 2), event("b", NOW)], 0);
    await log.add([event("c", NOW - 1, { outcome: "failure", address: null, target: null })], 0);
    expect(await log.list(null, 10)).toEqual([
      event("b", NOW),
      event("c", NOW - 1, { outcome: "failure", address: null, target: null }),
      event("a", NOW - 2),
    ]);
  });

  it("adds the count of an event whose id it keeps", async () => {
    const { log } = fresh();
    const counted = event("webdav.auth:1", NOW, { action: "webdav.auth", count: 3 });
    await log.add([counted], 0);
    await log.add([{ ...counted, count: 2 }], 0);
    expect(await log.list(null, 10)).toEqual([{ ...counted, count: 5 }]);
  });

  it("removes what is older than the cutoff in the same write, and nothing else", async () => {
    const { log } = fresh();
    const cutoff = NOW - AUDIT_RETENTION_MS;
    await log.add([event("old", cutoff - 1), event("edge", cutoff)], 0);
    await log.add([event("new", NOW)], cutoff);
    expect((await log.list(null, 10)).map((row) => row.id)).toEqual(["new", "edge"]);
    // A write with no event still removes what aged out.
    await log.add([], NOW + 1);
    expect(await log.list(null, 10)).toEqual([]);
  });

  it("writes nothing at all when a statement of the write fails", async () => {
    const { log } = fresh();
    await log.add([event("a", NOW)], 0);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a row the database refuses
    const broken = { ...event("b", NOW), action: null } as unknown as AuditRecord;
    await expect(log.add([broken], NOW + 1)).rejects.toThrow();
    expect((await log.list(null, 10)).map((row) => row.id)).toEqual(["a"]);
  });

  it("leaves out a row of an action or an outcome it does not know", async () => {
    const { db, log } = fresh();
    await log.add([event("a", NOW)], 0);
    await db.insert(schema.auditEvents).values([
      { id: "x", at: NOW + 1, action: "later.action", outcome: "success", count: 1 },
      { id: "y", at: NOW + 2, action: "export", outcome: "maybe", count: 1 },
    ]);
    expect((await log.list(null, 10)).map((row) => row.id)).toEqual(["a"]);
  });

  it("pages before a cursor by time, then by id", async () => {
    const { log } = fresh();
    await log.add([event("a", NOW), event("b", NOW), event("c", NOW), event("d", NOW - 1)], 0);
    expect((await log.list({ at: NOW, id: "c" }, 10)).map((row) => row.id)).toEqual([
      "b",
      "a",
      "d",
    ]);
    expect((await log.list({ at: NOW, id: "a" }, 1)).map((row) => row.id)).toEqual(["d"]);
    expect(await log.list({ at: NOW - 1, id: "d" }, 10)).toEqual([]);
  });

  it("lists every event once across pages of any size", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 8 }),
            at: fc.integer({ min: 0, max: 5 }),
          }),
          {
            selector: (row) => row.id,
            maxLength: 25,
          },
        ),
        fc.integer({ min: 1, max: 7 }),
        async (rows, limit) => {
          const { log } = fresh();
          await log.add(
            rows.map((row) => event(row.id, NOW + row.at)),
            0,
          );
          const seen: string[] = [];
          let cursor: { at: number; id: string } | null = null;
          for (let page = 0; page <= rows.length; page += 1) {
            const read = await log.list(cursor, limit);
            seen.push(...read.map((row) => row.id));
            const last = read.at(-1);
            if (read.length < limit || !last) break;
            cursor = { at: last.at, id: last.id };
          }
          expect(seen.toSorted()).toEqual(rows.map((row) => row.id).toSorted());
        },
      ),
      { numRuns: 40 },
    );
  });
});

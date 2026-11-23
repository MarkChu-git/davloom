import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeBackendRecords } from "@davloom/database/backend-records";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "@davloom/database/bun-sqlite";
import { afterAll } from "vitest";
import { databaseContract } from "./suite";

// Each test gets a database file of its own, so that a restart can open the file again.
const directory = mkdtempSync(join(tmpdir(), "davloom-database-contract-"));
const open = new Set<Database>();
let files = 0;

// What a self-hosted instance does when it starts: it opens the database file and brings it up to
// date with the migrations, which applies none to a file they have already built.
const start = (path: string) => {
  const sqlite = new Database(path);
  open.add(sqlite);
  const database = createBunSqliteDatabase(sqlite);
  migrateBunSqliteDatabase(database);
  return { sqlite, records: makeBackendRecords(database) };
};

const stop = (sqlite: Database): void => {
  sqlite.close();
  open.delete(sqlite);
};

afterAll(() => {
  for (const sqlite of open) {
    stop(sqlite);
  }
  rmSync(directory, { recursive: true, force: true });
});

databaseContract("Bun SQLite", {
  empty: async () => {
    files += 1;
    const path = join(directory, `${files}.sqlite`);
    let instance = start(path);
    return {
      records: instance.records,
      restart: async () => {
        stop(instance.sqlite);
        instance = start(path);
        return instance.records;
      },
    };
  },
});

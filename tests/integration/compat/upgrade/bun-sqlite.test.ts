import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "@davloom/database/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterAll } from "vitest";
import { upgradeSuite } from "./suite";
import { schemaTable } from "./tables";

// The self-hosted upgrade: Drizzle's migrator, which the Bun entry runs at every start, finds the
// migrations an older release applied in __drizzle_migrations and applies the rest.

const MIGRATIONS = resolve(import.meta.dirname, "../../../../packages/database/drizzle");

const journal: unknown = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8"));
const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
const entries = field(journal, "entries");
if (!Array.isArray(entries)) throw new Error("the migration journal lists no entries");
/** The journal's entries in order, each named by the tag of its .sql file. */
const tags = entries.map((entry: unknown) => {
  const tag = field(entry, "tag");
  if (typeof tag !== "string")
    throw new Error(`a journal entry has no tag: ${JSON.stringify(entry)}`);
  return tag;
});
const scratch = mkdtempSync(join(tmpdir(), "davloom-upgrade-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A migrations folder that holds the first `count` migrations, as an older release shipped it. */
const olderRelease = (count: number): string => {
  const folder = join(scratch, `release-${count}`);
  mkdirSync(join(folder, "meta"), { recursive: true });
  for (const tag of tags.slice(0, count)) {
    copyFileSync(join(MIGRATIONS, `${tag}.sql`), join(folder, `${tag}.sql`));
  }
  writeFileSync(
    join(folder, "meta/_journal.json"),
    JSON.stringify({
      version: field(journal, "version"),
      dialect: field(journal, "dialect"),
      entries: entries.slice(0, count),
    }),
  );
  return folder;
};

upgradeSuite({
  name: "Bun SQLite",
  migrations: tags,
  create: (label) => {
    // A file rather than :memory:, as a deployment keeps it.
    const sqlite = new Database(join(scratch, `${label}.sqlite`));
    sqlite.exec("pragma foreign_keys = on");
    const database = createBunSqliteDatabase(sqlite);
    return {
      install: async (count) => migrate(database, { migrationsFolder: olderRelease(count) }),
      upgrade: async () => migrateBunSqliteDatabase(database),
      run: async (sql, values) => {
        sqlite.query(sql).run(...values);
      },
      rows: async (sql) => sqlite.query<Record<string, unknown>, []>(sql).all(),
      select: async (table) => database.select().from(schemaTable(table)).all(),
    };
  },
});

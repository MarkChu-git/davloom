import { resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, "../drizzle");

export const createBunSqliteDatabase = (sqlite: Database) => drizzle(sqlite, { schema });

/** Brings a self-hosted database up to date. D1 uses `wrangler d1 migrations apply` instead. */
export const migrateBunSqliteDatabase = (database: ReturnType<typeof createBunSqliteDatabase>) =>
  migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });

/** Runs statements in one Bun SQLite transaction. */
export const bunSqliteAtomic =
  (db: ReturnType<typeof createBunSqliteDatabase>) =>
  (statements: readonly { run: () => unknown }[]): Promise<void> => {
    db.transaction(() => {
      for (const statement of statements) statement.run();
    });
    return Promise.resolve();
  };

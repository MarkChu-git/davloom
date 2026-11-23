import { Database } from "bun:sqlite";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "@davloom/database/bun-sqlite";
import type { TestProject } from "vitest/node";
import { type DatabaseSchema, readSchema } from "./schema";

declare module "vitest" {
  export interface ProvidedContext {
    /** The schema of an empty Bun SQLite database that the repository's migrations have built. */
    readonly bunSqliteSchema: DatabaseSchema;
  }
}

// The global setup of the D1 run. It runs in the process that starts the run, which runs on Bun
// (`bun --bun vitest`), so it migrates an empty Bun SQLite database as the Bun run does and reads
// its schema. vitest.database-d1.config.ts hands the schema to workerd as a binding, and the D1
// test compares it with D1's. A run started without `--bun` fails here, at the bun:sqlite import.
export default async function setup(project: TestProject): Promise<void> {
  const sqlite = new Database(":memory:");
  try {
    migrateBunSqliteDatabase(createBunSqliteDatabase(sqlite));
    const schema = await readSchema(async (sql) =>
      sqlite.query<Record<string, unknown>, []>(sql).all(),
    );
    project.provide("bunSqliteSchema", schema);
  } finally {
    sqlite.close();
  }
}

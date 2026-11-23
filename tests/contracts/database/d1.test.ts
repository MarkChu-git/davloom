import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { makeBackendRecords } from "@davloom/database/backend-records";
import { createD1Database } from "@davloom/database/d1";
import { describe, expect, it } from "vitest";
import { type DatabaseSchema, declaredTables, readSchema } from "./schema";
import { databaseContract } from "./suite";

declare global {
  namespace Cloudflare {
    /** The bindings that vitest.database-d1.config.ts gives this test. */
    interface Env {
      readonly DB: D1Database;
      readonly TEST_MIGRATIONS: D1Migration[];
      readonly BUN_SQLITE_SCHEMA: DatabaseSchema;
    }
  }
}

const { DB, TEST_MIGRATIONS, BUN_SQLITE_SCHEMA } = env;

// One D1 database serves the whole run, and the pool keeps its rows from one test to the next.
// Applying the migrations again applies none, so each test only deletes the records left before.
databaseContract("D1", {
  empty: async () => {
    await applyD1Migrations(DB, TEST_MIGRATIONS);
    await DB.prepare("delete from storage_backends").run();
    return {
      records: makeBackendRecords(createD1Database(DB)),
      // A Worker that starts again reaches the same database through its binding, and D1 applies
      // migrations only when `wrangler d1 migrations apply` runs, not when a Worker starts.
      restart: async () => makeBackendRecords(createD1Database(DB)),
    };
  },
});

// The global setup read the Bun SQLite schema in the process that started this run, so the two
// databases' schemas meet in one comparison.
describe("the schema on D1 and on Bun SQLite", () => {
  it("The schema on both databases", async () => {
    await applyD1Migrations(DB, TEST_MIGRATIONS);
    const d1 = await readSchema(async (sql) => (await DB.prepare(sql).all()).results);

    expect(d1).toEqual(BUN_SQLITE_SCHEMA);
    // Both hold the tables that schema.ts declares, so an equal pair of empty schemas cannot pass.
    expect(Object.keys(d1.columns).toSorted()).toEqual(declaredTables());
  });
});

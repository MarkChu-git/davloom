import { Database } from "bun:sqlite";
import { createAuth } from "@davloom/auth";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "@davloom/database/bun-sqlite";
import { identitySuite } from "./suite";

identitySuite("Bun SQLite", () => {
  const sqlite = new Database(":memory:");
  const database = createBunSqliteDatabase(sqlite);
  return {
    migrate: async () => migrateBunSqliteDatabase(database),
    rows: async (sql) => sqlite.query<Record<string, unknown>, []>(sql).all(),
    auth: createAuth({
      database,
      secret: "compatibility-test-secret-not-used-anywhere-else",
      baseURL: "http://localhost",
    }),
  };
});

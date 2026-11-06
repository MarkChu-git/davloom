import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createAuth } from "@davloom/auth";
import { createD1Database } from "@davloom/database/d1";
import { identitySuite } from "./suite";

declare global {
  namespace Cloudflare {
    /** The bindings that vitest.d1.config.ts gives this test. */
    interface Env {
      readonly DB: D1Database;
      readonly TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const { DB, TEST_MIGRATIONS } = env;

identitySuite("D1", () => ({
  migrate: () => applyD1Migrations(DB, TEST_MIGRATIONS),
  rows: async (sql) => (await DB.prepare(sql).all()).results,
  auth: createAuth({
    database: createD1Database(DB),
    secret: "compatibility-test-secret-not-used-anywhere-else",
    baseURL: "http://localhost",
  }),
}));

import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createD1Database } from "@davloom/database/d1";
import type { Value } from "./samples";
import { upgradeSuite } from "./suite";
import { schemaTable } from "./tables";

// The Cloud Free upgrade: `wrangler d1 migrations apply`, which the deploy workflow runs, records
// each applied migration by name in d1_migrations and applies the rest. applyD1Migrations does the
// same in local workerd.

declare global {
  namespace Cloudflare {
    /** The bindings that vitest.d1.config.ts gives this test. */
    interface Env {
      readonly TEST_MIGRATIONS: D1Migration[];
      /** One empty database for each start point, and one for a new install. */
      readonly [upgrade: `UPGRADE_${string}`]: D1Database;
    }
  }
}

const { TEST_MIGRATIONS } = env;

/** The tag of a migration file, such as 0000_initial for 0000_initial.sql. */
const tags = TEST_MIGRATIONS.map((migration) => migration.name.replace(/\.sql$/, ""));

const bindingFor = (label: string): D1Database => {
  const binding = env[`UPGRADE_${label.replaceAll("-", "_")}`];
  if (binding === undefined) throw new Error(`vitest.d1.config.ts declares no database ${label}`);
  return binding;
};

upgradeSuite({
  name: "D1",
  migrations: tags,
  create: (label) => {
    const binding = bindingFor(label);
    const database = createD1Database(binding);
    return {
      install: (count) => applyD1Migrations(binding, TEST_MIGRATIONS.slice(0, count)),
      upgrade: () => applyD1Migrations(binding, TEST_MIGRATIONS),
      run: async (sql: string, values: readonly Value[]) => {
        await binding
          .prepare(sql)
          .bind(...values)
          .run();
      },
      rows: async (sql) => (await binding.prepare(sql).all()).results,
      select: (table) => database.select().from(schemaTable(table)).all(),
    };
  },
});

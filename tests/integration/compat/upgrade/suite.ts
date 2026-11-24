import { beforeAll, describe, expect, it } from "vitest";
import { SAMPLES, type Row, type Sample, type Value } from "./samples";

// Database upgrade tests (PRD §11): a database that an older release migrated, with data in it,
// upgraded to the latest migrations the way a deployment upgrades it. Each start point is one of
// the older migration sets, 0000 up to the one before the latest. The data must survive, and the
// upgraded schema must be the one a new install gets.

/** What the suite needs from one empty database of a kind. */
export interface UpgradeHarness {
  /** Applies the first `count` migrations, as the release that shipped them did. */
  install(count: number): Promise<void>;
  /** Applies every migration not applied yet, the way a deployment upgrades its database. */
  upgrade(): Promise<void>;
  run(sql: string, values: readonly Value[]): Promise<void>;
  rows(sql: string): Promise<Record<string, unknown>[]>;
  /** Reads every row of a table through Drizzle and the schema the code runs with. */
  select(table: string): Promise<unknown[]>;
}

export interface UpgradeTarget {
  readonly name: string;
  /** The tags of the migrations in order, such as 0000_initial. */
  readonly migrations: readonly string[];
  /** A new empty database; `label` tells databases apart where the kind needs it. */
  readonly create: (label: string) => UpgradeHarness | Promise<UpgradeHarness>;
}

/** The samples of the first `count` migrations, in the order they can be written. */
export const samplesUpTo = (migrations: readonly string[], count: number): Sample[] =>
  migrations.slice(0, count).flatMap((tag) => SAMPLES[tag] ?? []);

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

export const insert = (harness: UpgradeHarness, { table, row }: Sample) => {
  const columns = Object.keys(row);
  return harness.run(
    `insert into ${quote(table)} (${columns.map(quote).join(", ")}) values (${columns.map(() => "?").join(", ")})`,
    columns.map((column) => row[column] ?? null),
  );
};

/** Whether `actual` holds every column of `row` with the same value. */
const holds = (actual: Record<string, unknown>, row: Row) =>
  Object.entries(row).every(([column, value]) => actual[column] === value);

/** The tables and indexes of the database, without the migration tools' own and SQLite's. */
const SCHEMA = `select type, name, tbl_name, sql from sqlite_master
  where name not like 'sqlite_%' and name not like '_cf_%'
    and name not in ('d1_migrations', '__drizzle_migrations')
  order by type, name`;

const describeSample = ({ table, row }: Sample) => `${table} ${String(Object.values(row)[0])}`;

export const upgradeSuite = ({ name, migrations, create }: UpgradeTarget) => {
  describe(`database upgrades on ${name}`, () => {
    let fresh: Record<string, unknown>[];

    beforeAll(async () => {
      const harness = await create("fresh");
      await harness.upgrade();
      fresh = await harness.rows(SCHEMA);
    });

    it("finds more than one migration, so there is an older set to upgrade from", () => {
      expect(migrations.length).toBeGreaterThan(1);
    });

    it.each(migrations)("migration %s has sample rows for the suite to carry", (tag) => {
      expect(SAMPLES[tag]?.length ?? 0).toBeGreaterThan(0);
    });

    it("every sample row's migration is one of the migrations", () => {
      expect(Object.keys(SAMPLES).filter((tag) => !migrations.includes(tag))).toEqual([]);
    });

    it("every table of a new install has sample rows", async () => {
      const tables = fresh
        .filter((entry) => entry["type"] === "table")
        .map((entry) => entry["name"]);
      const sampled = new Set(samplesUpTo(migrations, migrations.length).map((s) => s.table));
      expect(tables.filter((table) => !sampled.has(String(table)))).toEqual([]);
    });

    // From each older migration set: 0000 alone, then 0000 and 0001, up to all but the latest.
    const starts = migrations.slice(0, -1).map((tag, index) => [tag, index + 1] as const);

    describe.each(starts)("from a database that ends at %s", (_tag, count) => {
      const before = samplesUpTo(migrations, count);
      const added = samplesUpTo(migrations, migrations.length).slice(before.length);
      let harness: UpgradeHarness;
      let tablesBefore: unknown[];

      beforeAll(async () => {
        harness = await create(`from-${count}`);
        await harness.install(count);
        for (const sample of before) {
          await insert(harness, sample);
        }
        tablesBefore = (await harness.rows(SCHEMA))
          .filter((entry) => entry["type"] === "table")
          .map((entry) => entry["name"]);
        await harness.upgrade();
      });

      it("starts without the tables of the later migrations", () => {
        const later = new Set(added.map((sample) => sample.table));
        for (const { table } of before) later.delete(table);
        expect(later.size).toBeGreaterThan(0);
        expect(tablesBefore.filter((table) => later.has(String(table)))).toEqual([]);
      });

      it.each(before.map((sample) => [describeSample(sample), sample] as const))(
        "keeps the row %s",
        async (_label, { table, row }) => {
          const rows = await harness.rows(`select * from ${quote(table)}`);
          expect(rows.filter((actual) => holds(actual, row))).toHaveLength(1);
        },
      );

      it("keeps the number of rows in every table", async () => {
        const counts = new Map<string, number>();
        for (const { table } of before) counts.set(table, (counts.get(table) ?? 0) + 1);
        for (const [table, expected] of counts) {
          const [row] = await harness.rows(`select count(*) as total from ${quote(table)}`);
          expect(Number(row?.["total"]), table).toBe(expected);
        }
      });

      it("ends with the schema of a new install", async () => {
        expect(await harness.rows(SCHEMA)).toEqual(fresh);
      });

      it("reads the kept rows through the schema the code runs with", async () => {
        for (const table of new Set(before.map((sample) => sample.table))) {
          const expected = before.filter((sample) => sample.table === table).length;
          expect(await harness.select(table), table).toHaveLength(expected);
        }
      });

      it.each(added.map((sample) => [describeSample(sample), sample] as const))(
        "then stores the row %s of a later migration",
        async (_label, sample) => {
          await insert(harness, sample);
          const rows = await harness.rows(`select * from ${quote(sample.table)}`);
          expect(rows.filter((actual) => holds(actual, sample.row))).toHaveLength(1);
        },
      );

      it("changes nothing when it upgrades again", async () => {
        const schema = await harness.rows(SCHEMA);
        const counts = await Promise.all(
          [...new Set(before.map((sample) => sample.table))].map((table) =>
            harness.rows(`select count(*) as total from ${quote(table)}`),
          ),
        );
        await harness.upgrade();
        expect(await harness.rows(SCHEMA)).toEqual(schema);
        expect(
          await Promise.all(
            [...new Set(before.map((sample) => sample.table))].map((table) =>
              harness.rows(`select count(*) as total from ${quote(table)}`),
            ),
          ),
        ).toEqual(counts);
      });
    });
  });
};

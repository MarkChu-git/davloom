import * as schema from "@davloom/database/schema";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

// The schema that the migrations build, read back the same way on D1 and on Bun SQLite, so the two
// can be compared ("The schema on both databases" in specs/instance-database).

/** The rows that one SQL statement returns on a database. */
export type Query = (sql: string) => Promise<ReadonlyArray<Record<string, unknown>>>;

/** An entry of `sqlite_master`: a table, an index, a view or a trigger. */
export type SchemaObject = {
  readonly type: string;
  readonly name: string;
  readonly table: string;
  /** The statement that creates it, or null for an index that SQLite makes for a constraint. */
  readonly sql: string | null;
};

/** A column as `PRAGMA table_info` describes it. */
export type SchemaColumn = {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
};

// Type aliases with mutable arrays, so that a schema is a JSON value that Miniflare can bind.
export type DatabaseSchema = {
  /** Every entry of `sqlite_master` but those of the tables below, in the order of type and name. */
  readonly objects: SchemaObject[];
  /** Each table's columns, in the order of the table's definition. */
  readonly columns: Record<string, SchemaColumn[]>;
};

/**
 * Whether a table is one that a database or a migration runner keeps for itself: D1's and
 * Drizzle's records of applied migrations, Cloudflare's own tables, and SQLite's.
 */
export const keptForItself = (table: string): boolean =>
  table === "d1_migrations" ||
  table === "__drizzle_migrations" ||
  table.startsWith("_cf_") ||
  table.startsWith("sqlite_");

const text = (row: Record<string, unknown>, field: string): string => {
  const value = row[field];
  if (typeof value !== "string") {
    throw new TypeError(`sqlite_master gave ${field} as ${JSON.stringify(value)}`);
  }
  return value;
};

const ascending = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * Reads a database's schema. It leaves out the tables that `keptForItself` names, with their
 * indexes, and the `rootpage` of each entry, a page number that depends on the order in which
 * the database created its tables, its own among them.
 */
export const readSchema = async (query: Query): Promise<DatabaseSchema> => {
  const objects = (await query("select type, name, tbl_name, sql from sqlite_master"))
    .map((row) => ({
      type: text(row, "type"),
      name: text(row, "name"),
      table: text(row, "tbl_name"),
      sql: row["sql"] === null ? null : text(row, "sql"),
    }))
    .filter((object) => !keptForItself(object.table))
    .toSorted(
      (left, right) => ascending(left.type, right.type) || ascending(left.name, right.name),
    );
  const tables = objects.filter((object) => object.type === "table").map((object) => object.name);
  const columns: Record<string, SchemaColumn[]> = {};
  for (const table of tables) {
    const rows = await query(`PRAGMA table_info("${table.replaceAll('"', '""')}")`);
    columns[table] = rows.map((row) => ({
      cid: Number(row["cid"]),
      name: text(row, "name"),
      type: text(row, "type"),
      notnull: Number(row["notnull"]),
      dflt_value: row["dflt_value"] === null ? null : text(row, "dflt_value"),
      pk: Number(row["pk"]),
    }));
  }
  return { objects, columns };
};

/** The tables that `packages/database/src/schema.ts` declares, which the migrations build. */
export const declaredTables = (): string[] =>
  Object.values(schema)
    .filter((value) => is(value, SQLiteTable))
    .map((table) => getTableName(table))
    .toSorted(ascending);

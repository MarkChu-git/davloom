import {
  ARCHIVE_TABLES,
  mapArchiveTables,
  type ArchiveRow,
  type ArchiveTable,
  type ArchiveTables,
} from "@davloom/core";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Database } from "./repositories";
import * as schema from "./schema";

// The Archive Port on Drizzle: the rows of the exported tables, keyed by their SQL column names, so
// an export reads the same on D1 and on Bun SQLite and stays readable when the TypeScript names of
// the columns change. Times leave as milliseconds since the epoch and JSON columns as their values.
// A write inserts many rows per statement, as D1 binds at most 100 values per statement and runs
// at most 50 statements per invocation on the Free plan, and runs every statement in one batch or
// transaction, so a failure writes nothing.

/** Statements that run so that all take effect or none: D1's batch, or a Bun SQLite transaction. */
export type Atomic = (statements: readonly { run: () => unknown }[]) => Promise<void>;

const TABLES: Readonly<Record<ArchiveTable, SQLiteTable>> = {
  user: schema.user,
  account: schema.account,
  storage_backends: schema.storageBackends,
  mounts: schema.mounts,
  apikey: schema.apikey,
  dav_properties: schema.davProperties,
};

/** D1 binds at most 100 values to one statement. */
const MAX_BOUND = 100;

type Kind = "text" | "json" | "integer" | "boolean" | "timestamp";

const kindOf = (column: SQLiteColumn): Kind => {
  switch (column.columnType) {
    case "SQLiteTextJson":
      return "json";
    case "SQLiteBoolean":
      return "boolean";
    case "SQLiteTimestamp":
      return "timestamp";
    case "SQLiteInteger":
      return "integer";
    default:
      return "text";
  }
};

interface Column {
  readonly key: string;
  readonly name: string;
  readonly kind: Kind;
  readonly notNull: boolean;
}

const columnsOf = (table: SQLiteTable): Column[] =>
  Object.entries(getTableColumns(table)).map(([key, column]) => ({
    key,
    name: column.name,
    kind: kindOf(column),
    notNull: column.notNull,
  }));

const COLUMNS = mapArchiveTables((table) => columnsOf(TABLES[table]));

const fromDatabase = (kind: Kind, value: unknown): unknown =>
  kind === "timestamp" && value instanceof Date ? value.getTime() : (value ?? null);

const toDatabase = (kind: Kind, value: unknown): unknown =>
  kind === "timestamp" && typeof value === "number" ? new Date(value) : value;

const KIND_TEST: Readonly<Record<Kind, (value: unknown) => boolean>> = {
  text: (value) => typeof value === "string",
  boolean: (value) => typeof value === "boolean",
  integer: (value) => Number.isSafeInteger(value),
  timestamp: (value) => Number.isSafeInteger(value),
  json: () => true,
};

const KIND_PROBLEM: Readonly<Record<Kind, string>> = {
  text: "is not text",
  boolean: "is not true or false",
  integer: "is not a whole number",
  timestamp: "is not a whole number",
  json: "",
};

/** Why a value does not fit its column, or null. */
const misfit = (column: Column, value: unknown): string | null => {
  // An export holds every column of every row, so a row is written exactly as it was read.
  if (value === undefined) return "is missing";
  if (value === null) return column.notNull ? "is missing" : null;
  return KIND_TEST[column.kind](value) ? null : KIND_PROBLEM[column.kind];
};

export const createArchive = (db: Database, atomic: Atomic) => ({
  read: async (): Promise<ArchiveTables> => {
    const read: Record<ArchiveTable, readonly ArchiveRow[]> = mapArchiveTables(() => []);
    for (const name of ARCHIVE_TABLES) {
      const rows: Record<string, unknown>[] = await db.select().from(TABLES[name]);
      read[name] = rows.map((row) =>
        Object.fromEntries(
          COLUMNS[name].map((column) => [column.name, fromDatabase(column.kind, row[column.key])]),
        ),
      );
    }
    return read;
  },

  check: (tables: ArchiveTables): string | null => {
    for (const name of ARCHIVE_TABLES) {
      const columns = COLUMNS[name];
      const known = new Set(columns.map((column) => column.name));
      for (const [index, row] of tables[name].entries()) {
        const unknown = Object.keys(row).find((key) => !known.has(key));
        if (unknown !== undefined)
          return `Row ${index + 1} of ${name} has an unknown column ${unknown}.`;
        for (const column of columns) {
          const problem = misfit(column, row[column.name]);
          if (problem !== null) {
            return `The ${column.name} of row ${index + 1} of ${name} ${problem}.`;
          }
        }
      }
    }
    return null;
  },

  write: async (tables: ArchiveTables): Promise<void> => {
    const statements: { run: () => unknown }[] = [];
    for (const name of ARCHIVE_TABLES) {
      const table = TABLES[name];
      const columns = COLUMNS[name];
      const values = tables[name].map((row) =>
        Object.fromEntries(
          columns.map((column) => [column.key, toDatabase(column.kind, row[column.name])]),
        ),
      );
      const perStatement = Math.max(1, Math.floor(MAX_BOUND / columns.length));
      for (let start = 0; start < values.length; start += perStatement) {
        statements.push(db.insert(table).values(values.slice(start, start + perStatement)));
      }
    }
    if (statements.length > 0) await atomic(statements);
  },
});

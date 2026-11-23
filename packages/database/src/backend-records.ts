import {
  BackendNameTakenError,
  BackendNotFoundError,
  BackendRecords,
  type BackendConfig,
  type BackendRecord,
} from "@davloom/core";
import { asc, DrizzleQueryError, eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { type Context, Effect, Layer } from "effect";
import type * as schema from "./schema";
import { storageBackends } from "./schema";

// The backend records adapter (Decision 9 of add-phase-1-core), written once against Drizzle's
// SQLite dialect and used with D1 and with Bun SQLite. Each operation is one statement, because D1
// has no interactive transactions and no operation here needs two statements to commit together.

/** A Drizzle database on D1, whose queries are asynchronous, or on Bun SQLite, whose are not. */
export type SQLiteDatabase = BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema>;

// A unique-constraint failure on `storage_backends.name`, and on no other column, in the words of
// each database. Bun SQLite throws its own SQLiteError, with the code SQLITE_CONSTRAINT_UNIQUE and
// the first message. D1's driver throws Drizzle's DrizzleQueryError, whose cause is D1's error with
// the second message, and whose cause in turn holds that message without `D1_ERROR: `. A duplicate
// id names `storage_backends.id` instead, with SQLITE_CONSTRAINT_PRIMARYKEY. Both patterns are
// anchored at the start, because DrizzleQueryError's own message lists the query's parameters, and
// a backend's name or fields may hold any text.
const NAME_TAKEN = [
  /^UNIQUE constraint failed: storage_backends\.name$/,
  /^D1_ERROR: UNIQUE constraint failed: storage_backends\.name: SQLITE_CONSTRAINT\b/,
];

/** Whether a failed insert broke the unique index on backend names, on either database. */
export const isNameTaken = (error: unknown): boolean => {
  const seen = new Set<Error>();
  for (let current = error; current instanceof Error; current = current.cause) {
    if (seen.has(current)) {
      return false;
    }
    seen.add(current);
    const { message } = current;
    if (NAME_TAKEN.some((pattern) => pattern.test(message))) {
      return true;
    }
  }
  return false;
};

/**
 * The defect that a failed statement becomes. DrizzleQueryError prints the query's parameters,
 * which for a save hold the sealed secret key, so the defect keeps the query and the database's
 * own error and leaves the parameters out. Bun SQLite's errors hold no parameters.
 */
export const statementDefect = (error: unknown): unknown =>
  error instanceof DrizzleQueryError
    ? new Error(`Failed query: ${error.query}`, { cause: error.cause })
    : error;

// One statement, whose failure is a defect.
const statement = <A>(run: () => PromiseLike<A>): Effect.Effect<A> =>
  Effect.tryPromise({ try: async () => await run(), catch: statementDefect }).pipe(Effect.orDie);

type Row = typeof storageBackends.$inferSelect;

// Whether a stored configuration has the shape that `save` writes: a JSON object of string and
// boolean fields.
const isBackendConfig = (value: unknown): value is BackendConfig =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((field) => typeof field === "string" || typeof field === "boolean");

// A row as a record. A configuration of another shape was not written by `save`, so the database
// holds what the adapter cannot read, which is a defect.
const toRecord = (row: Row): Effect.Effect<BackendRecord> =>
  isBackendConfig(row.config)
    ? Effect.succeed({
        id: row.id,
        name: row.name,
        kind: row.kind,
        config: row.config,
        sealedSecretKey: row.secretKey,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
    : Effect.die(
        new Error(
          `The stored configuration of storage backend ${row.id} is not an object of string and boolean fields.`,
        ),
      );

/** The backend records on a database that the repository's migrations have built. */
export const makeBackendRecords = (
  database: SQLiteDatabase,
): Context.Service.Shape<typeof BackendRecords> => ({
  save: (record) =>
    Effect.tryPromise({
      try: async () => {
        await database.insert(storageBackends).values({
          id: record.id,
          name: record.name,
          kind: record.kind,
          config: record.config,
          secretKey: record.sealedSecretKey,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
      },
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        isNameTaken(error)
          ? Effect.fail(new BackendNameTakenError({ backendName: record.name }))
          : Effect.die(statementDefect(error)),
      ),
    ),
  list: Effect.flatMap(
    statement(() => database.select().from(storageBackends).orderBy(asc(storageBackends.name))),
    (rows) => Effect.forEach(rows, toRecord),
  ),
  read: (id) =>
    Effect.flatMap(
      statement(() =>
        database.select().from(storageBackends).where(eq(storageBackends.id, id)).limit(1),
      ),
      ([row]) =>
        row === undefined
          ? Effect.fail(new BackendNotFoundError({ backendId: id }))
          : toRecord(row),
    ),
  remove: (id) =>
    Effect.flatMap(
      statement(() =>
        database
          .delete(storageBackends)
          .where(eq(storageBackends.id, id))
          .returning({ id: storageBackends.id }),
      ),
      (removed) =>
        removed.length === 0
          ? Effect.fail(new BackendNotFoundError({ backendId: id }))
          : Effect.void,
    ),
});

/** The backend records as a Layer, for the backend service. */
export const backendRecordsLayer = (database: SQLiteDatabase): Layer.Layer<BackendRecords> =>
  Layer.succeed(BackendRecords, makeBackendRecords(database));

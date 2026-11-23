import { Database } from "bun:sqlite";
import {
  BackendNameTakenError,
  BackendNotFoundError,
  BackendRecords,
  type BackendRecord,
} from "@davloom/core";
import { DrizzleQueryError } from "drizzle-orm";
import { Cause, Effect, Exit } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import {
  backendRecordsLayer,
  isNameTaken,
  makeBackendRecords,
  statementDefect,
} from "./backend-records";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "./bun-sqlite";

// The unit tests of the backend records adapter run its statements on Bun SQLite. D1 runs only in
// workerd, so the database contract suite in tests/contracts runs them on D1; here the mapping of
// D1's unique-constraint error gets the error D1 raised there, rebuilt (Decision 9).

const record = (id: string, name: string, more: Partial<BackendRecord> = {}): BackendRecord => ({
  id,
  name,
  kind: "s3",
  config: {
    endpoint: "http://localhost:9000",
    region: "us-east-1",
    bucket: "archive",
    prefix: "",
    pathStyle: true,
    accessKey: "not-a-real-access-key",
  },
  sealedSecretKey: "v1.not-a-real-iv.not-a-real-ciphertext",
  createdAt: new Date(1_795_166_203_855),
  updatedAt: new Date(1_795_166_203_855),
  ...more,
});

const PHOTOS = record("0193f3c2-7a11-7d42-9d2c-000000000001", "Photos");
const ARCHIVE = record("0193f3c2-7a11-7d42-9d2c-000000000002", "Archive", {
  kind: "r2",
  config: { binding: "ARCHIVE", prefix: "davloom/" },
  sealedSecretKey: null,
});

// The error a failed effect ended with, which has to be a typed error and not a defect.
const failure = async <E>(effect: Effect.Effect<unknown, E>): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    throw new Error("succeeded");
  }
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") {
    throw new Error(`failed without an error: ${Cause.pretty(exit.cause)}`);
  }
  return error.value;
};

// The defect a failed effect ended with, which has to have no typed error.
const defect = async (effect: Effect.Effect<unknown, unknown>): Promise<unknown> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    throw new Error("succeeded");
  }
  expect(Cause.findErrorOption(exit.cause)._tag).toBe("None");
  const found = Cause.findDefect(exit.cause);
  if (found._tag === "Failure") {
    throw new Error(`failed without a defect: ${Cause.pretty(exit.cause)}`);
  }
  return found.success;
};

// The errors Bun SQLite raises for a second row with a taken name and with a taken id.
const bunErrors = (): { name: unknown; id: unknown } => {
  const sqlite = new Database(":memory:");
  migrateBunSqliteDatabase(createBunSqliteDatabase(sqlite));
  const insert = (id: string, name: string): unknown => {
    try {
      sqlite.run(
        "insert into storage_backends (id, name, kind, config, created_at, updated_at) values (?, ?, 'r2', '{}', 0, 0)",
        [id, name],
      );
      return undefined;
    } catch (error) {
      return error;
    }
  };
  insert("a", "Photos");
  return { name: insert("b", "Photos"), id: insert("a", "Other") };
};

// The query Drizzle's D1 driver ran for a save, and the error it raised, as the database contract
// suite saw them in workerd: Drizzle's DrizzleQueryError, whose message lists the parameters,
// around D1's error, around the same message without `D1_ERROR: `.
const INSERT =
  'insert into "storage_backends" ("id", "name", "kind", "config", "secret_key", "created_at", "updated_at") values (?, ?, ?, ?, ?, ?, ?)';
const d1Error = (column: string, constraint: string, params: unknown[] = []) =>
  new DrizzleQueryError(
    INSERT,
    params,
    new Error(
      `D1_ERROR: UNIQUE constraint failed: ${column}: SQLITE_CONSTRAINT (extended: ${constraint})`,
      {
        cause: new Error(
          `UNIQUE constraint failed: ${column}: SQLITE_CONSTRAINT (extended: ${constraint})`,
        ),
      },
    ),
  );

describe("the unique-constraint errors of both databases", () => {
  it("a taken name on Bun SQLite is a taken name", () => {
    const { name } = bunErrors();
    expect(name).toMatchObject({
      name: "SQLiteError",
      code: "SQLITE_CONSTRAINT_UNIQUE",
      message: "UNIQUE constraint failed: storage_backends.name",
    });
    expect(isNameTaken(name)).toBe(true);
  });

  it("a taken id on Bun SQLite is not", () => {
    const { id } = bunErrors();
    expect(id).toMatchObject({
      code: "SQLITE_CONSTRAINT_PRIMARYKEY",
      message: "UNIQUE constraint failed: storage_backends.id",
    });
    expect(isNameTaken(id)).toBe(false);
  });

  it("a taken name on D1 is a taken name", () => {
    expect(isNameTaken(d1Error("storage_backends.name", "SQLITE_CONSTRAINT_UNIQUE"))).toBe(true);
  });

  it.each([
    ["a taken id", d1Error("storage_backends.id", "SQLITE_CONSTRAINT_PRIMARYKEY")],
    ["a taken email in another table", d1Error("user.email", "SQLITE_CONSTRAINT_UNIQUE")],
    [
      "an index over the name and another column",
      d1Error("storage_backends.name, storage_backends.kind", "SQLITE_CONSTRAINT_UNIQUE"),
    ],
    // DrizzleQueryError's message lists the parameters, which hold the name and the fields.
    [
      "a taken id whose parameters quote both messages",
      d1Error("storage_backends.id", "SQLITE_CONSTRAINT_PRIMARYKEY", [
        "UNIQUE constraint failed: storage_backends.name",
        "D1_ERROR: UNIQUE constraint failed: storage_backends.name: SQLITE_CONSTRAINT",
      ]),
    ],
  ])("%s on D1 is not", (_what, error) => {
    expect(isNameTaken(error)).toBe(false);
  });

  it.each([
    ["the message alone", "UNIQUE constraint failed: storage_backends.name"],
    ["an object with the message", { message: "UNIQUE constraint failed: storage_backends.name" }],
    ["nothing", undefined],
  ])("%s is not an error, so not a taken name", (_what, value) => {
    expect(isNameTaken(value)).toBe(false);
  });

  it("stops at a cause that leads back to an error it has read", () => {
    const first = new Error("database is locked");
    first.cause = new Error("SQLITE_BUSY", { cause: first });
    expect(isNameTaken(first)).toBe(false);
  });
});

describe("the defect of a failed statement", () => {
  it("keeps D1's query and error but not the parameters", () => {
    const error = d1Error("storage_backends.id", "SQLITE_CONSTRAINT_PRIMARYKEY", [
      PHOTOS.id,
      PHOTOS.name,
      PHOTOS.sealedSecretKey,
    ]);
    const result = statementDefect(error);
    expect(result).toBeInstanceOf(Error);
    expect(result).toMatchObject({ message: `Failed query: ${INSERT}`, cause: error.cause });
    expect(error.message).toContain(String(PHOTOS.sealedSecretKey));
    expect(String(result)).not.toContain(String(PHOTOS.sealedSecretKey));
  });

  it("is Bun SQLite's own error, which holds no parameters", () => {
    const { id } = bunErrors();
    expect(statementDefect(id)).toBe(id);
  });
});

describe("the backend records on Bun SQLite", () => {
  let sqlite: Database;
  let records: ReturnType<typeof makeBackendRecords>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    const database = createBunSqliteDatabase(sqlite);
    migrateBunSqliteDatabase(database);
    records = makeBackendRecords(database);
  });

  it("reads and lists a saved record as it was saved", async () => {
    await Effect.runPromise(records.save(PHOTOS));
    await Effect.runPromise(records.save(ARCHIVE));
    expect(await Effect.runPromise(records.read(PHOTOS.id))).toEqual(PHOTOS);
    expect(await Effect.runPromise(records.list)).toEqual([ARCHIVE, PHOTOS]);
  });

  it("stores the configuration as JSON and the sealed secret key as it is", async () => {
    await Effect.runPromise(records.save(PHOTOS));
    expect(sqlite.query("select config, secret_key from storage_backends").all()).toEqual([
      { config: JSON.stringify(PHOTOS.config), secret_key: PHOTOS.sealedSecretKey },
    ]);
  });

  it("fails a second save of a name with a name-taken error and stores nothing", async () => {
    await Effect.runPromise(records.save(PHOTOS));
    const error = await failure(records.save({ ...ARCHIVE, name: PHOTOS.name }));
    expect(error).toBeInstanceOf(BackendNameTakenError);
    expect(error).toMatchObject({ backendName: PHOTOS.name });
    expect(await Effect.runPromise(records.list)).toEqual([PHOTOS]);
  });

  it("dies on a second save of an id, with the database's error", async () => {
    await Effect.runPromise(records.save(PHOTOS));
    expect(await defect(records.save({ ...ARCHIVE, id: PHOTOS.id }))).toMatchObject({
      code: "SQLITE_CONSTRAINT_PRIMARYKEY",
    });
    expect(await Effect.runPromise(records.list)).toEqual([PHOTOS]);
  });

  it("removes a record", async () => {
    await Effect.runPromise(records.save(PHOTOS));
    await Effect.runPromise(records.save(ARCHIVE));
    await Effect.runPromise(records.remove(PHOTOS.id));
    expect(await Effect.runPromise(records.list)).toEqual([ARCHIVE]);
  });

  it.each([
    ["reading", (id: string) => records.read(id)],
    ["removing", (id: string) => records.remove(id)],
  ])("fails %s an unknown id with a not-found error", async (_what, operation) => {
    await Effect.runPromise(records.save(PHOTOS));
    const error = await failure(operation(ARCHIVE.id));
    expect(error).toBeInstanceOf(BackendNotFoundError);
    expect(error).toMatchObject({ backendId: ARCHIVE.id });
    expect(await Effect.runPromise(records.list)).toEqual([PHOTOS]);
  });

  it.each([
    ["saving", () => records.save(PHOTOS)],
    ["listing", () => records.list],
    ["reading", () => records.read(PHOTOS.id)],
    ["removing", () => records.remove(PHOTOS.id)],
  ])("dies %s when the database fails", async (_what, operation) => {
    sqlite.run("drop table storage_backends");
    expect(await defect(operation())).toMatchObject({
      message: "no such table: storage_backends",
    });
  });

  // `save` writes only objects of string and boolean fields, so another configuration in the
  // column came from elsewhere, and the adapter refuses to pass it on as a record.
  it.each([
    ["a number", "7"],
    ["a string", '"archive"'],
    ["null", "null"],
    ["a list", '["archive"]'],
    ["a field that is a number", '{"bucket":7}'],
    ["a field that is an object", '{"bucket":{}}'],
  ])("dies reading or listing a stored configuration that is %s", async (_what, config) => {
    sqlite.run(
      "insert into storage_backends (id, name, kind, config, created_at, updated_at) values (?, 'Broken', 's3', ?, 0, 0)",
      [PHOTOS.id, config],
    );
    for (const operation of [records.read(PHOTOS.id), records.list]) {
      expect(await defect(operation)).toMatchObject({
        message: `The stored configuration of storage backend ${PHOTOS.id} is not an object of string and boolean fields.`,
      });
    }
  });

  it("provides the Port as a Layer", async () => {
    const listed = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* BackendRecords;
        yield* service.save(PHOTOS);
        return yield* service.list;
      }).pipe(Effect.provide(backendRecordsLayer(createBunSqliteDatabase(sqlite)))),
    );
    expect(listed).toEqual([PHOTOS]);
  });
});

import {
  BackendNameTakenError,
  BackendNotFoundError,
  type BackendRecord,
  type BackendRecords,
} from "@davloom/core";
import { Cause, type Context, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

// The database contract suite (Decision 9 of add-phase-1-core). It runs the backend records
// adapter of packages/database on D1 in workerd and on Bun SQLite, and every case has to pass on
// both ("One contract on both databases" in specs/instance-database).

type Records = Context.Service.Shape<typeof BackendRecords>;

/** A database under the suite, and the backend records of an instance on it. */
export interface DatabaseUnderTest {
  readonly records: Records;
  /** Starts the instance again on the same database and gives the new instance's records. */
  restart(): Promise<Records>;
}

export interface DatabaseHarness {
  /** A database that the repository's migrations have built and that holds no backend record. */
  empty(): Promise<DatabaseUnderTest>;
}

// Milliseconds included, because the timestamps are stored as milliseconds.
const SAVED_AT = new Date(Date.UTC(2026, 10, 20, 9, 30, 15, 123));

const backend = (
  id: number,
  name: string,
  kind: string,
  config: BackendRecord["config"],
  sealedSecretKey: string | null = null,
): BackendRecord => ({
  id: `0193f3c2-7a11-7d42-9d2c-${String(id).padStart(12, "0")}`,
  name,
  kind,
  config,
  sealedSecretKey,
  createdAt: SAVED_AT,
  updatedAt: SAVED_AT,
});

const NOTES = backend(1, "Notes", "durable-objects", {});
const PHOTOS = backend(2, "Photos", "r2", { binding: "PHOTOS", prefix: "" });
const ARCHIVE = backend(
  3,
  "Archive",
  "s3",
  {
    endpoint: "http://localhost:9000",
    region: "us-east-1",
    bucket: "archive",
    prefix: "davloom/",
    pathStyle: true,
    accessKey: "not-a-real-access-key",
  },
  "v1.not-a-real-iv.not-a-real-ciphertext",
);

const run = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  await Effect.runPromise(effect);

// The typed error a failed effect ended with.
const failure = async <E>(effect: Effect.Effect<unknown, E>): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    throw new Error("succeeded");
  }
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") {
    throw new Error(`failed without a typed error: ${Cause.pretty(exit.cause)}`);
  }
  return error.value;
};

// The defect a failed effect ended with, when it ended with no typed error.
const defect = async (effect: Effect.Effect<unknown, unknown>): Promise<unknown> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    throw new Error("succeeded");
  }
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "Some") {
    throw new Error(`failed with a typed error: ${String(error.value)}`);
  }
  const found = Cause.findDefect(exit.cause);
  if (found._tag === "Failure") {
    throw new Error(`failed without a defect: ${Cause.pretty(exit.cause)}`);
  }
  return found.success;
};

// The messages of an error and of each cause under it.
const messages = (error: unknown): string[] => {
  const found: string[] = [];
  for (
    let current = error;
    current instanceof Error && found.length < 10;
    current = current.cause
  ) {
    found.push(current.message);
  }
  return found;
};

// The order of code points, which SQLite's BINARY collation gives text stored as UTF-8. The
// default order of JavaScript's sort compares UTF-16 code units instead.
const byCodePoints = (left: string, right: string): number => {
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return a.length - b.length;
};

export const databaseContract = (name: string, harness: DatabaseHarness) => {
  describe(`backend records on ${name}`, () => {
    it("One contract on both databases: a saved record reads back as it was saved", async () => {
      const { records } = await harness.empty();
      await run(records.save(ARCHIVE));
      expect(await run(records.read(ARCHIVE.id))).toEqual(ARCHIVE);
    });

    it("One contract on both databases: the list holds every kind with its fields", async () => {
      const { records } = await harness.empty();
      for (const record of [NOTES, PHOTOS, ARCHIVE]) {
        await run(records.save(record));
      }
      expect(await run(records.list)).toEqual([ARCHIVE, NOTES, PHOTOS]);
    });

    it("One contract on both databases: the list follows the names' code points", async () => {
      const { records } = await harness.empty();
      // U+FF5A comes before U+1F600 by code point, and after it by UTF-16 code unit.
      const names = ["b", "ｚ", "B", "😀", "é", "a", "é", "A"];
      for (const [index, backendName] of names.entries()) {
        await run(records.save(backend(10 + index, backendName, "durable-objects", {})));
      }
      const expected = names.toSorted(byCodePoints);
      expect(expected).not.toEqual(names.toSorted());
      expect((await run(records.list)).map((record) => record.name)).toEqual(expected);
    });

    it("One contract on both databases: text and values round-trip unchanged", async () => {
      const { records } = await harness.empty();
      const record = backend(
        4,
        `Photos "2026" ✨ O'Brien \\ 写真`,
        "s3",
        {
          endpoint: "https://s3.example.test:9000",
          region: "",
          bucket: `a"b\\c`,
          prefix: "日本/写真/",
          pathStyle: false,
          accessKey: "%_ 'x' --",
        },
        "",
      );
      await run(records.save(record));
      expect(await run(records.read(record.id))).toEqual(record);
      expect(await run(records.list)).toEqual([record]);
    });

    it("One contract on both databases: a taken name fails the save and stores nothing", async () => {
      const { records } = await harness.empty();
      await run(records.save(PHOTOS));
      const error = await failure(records.save({ ...ARCHIVE, name: PHOTOS.name }));
      expect(error).toBeInstanceOf(BackendNameTakenError);
      expect(error).toMatchObject({ backendName: PHOTOS.name });
      expect(await run(records.list)).toEqual([PHOTOS]);
      expect(await failure(records.read(ARCHIVE.id))).toBeInstanceOf(BackendNotFoundError);
    });

    it("One contract on both databases: names that differ in any code point are not taken", async () => {
      const { records } = await harness.empty();
      // Case, and the two Unicode forms of é.
      const names = ["Photos", "photos", "Café", "Café"];
      for (const [index, backendName] of names.entries()) {
        await run(records.save(backend(20 + index, backendName, "durable-objects", {})));
      }
      expect((await run(records.list)).map((record) => record.name).toSorted()).toEqual(
        names.toSorted(),
      );
    });

    it("One contract on both databases: a taken id is a defect that holds no value", async () => {
      const { records } = await harness.empty();
      await run(records.save(ARCHIVE));
      const found = await defect(records.save({ ...PHOTOS, id: ARCHIVE.id }));
      expect(messages(found).length).toBeGreaterThan(0);
      for (const message of messages(found)) {
        expect(message).not.toContain(String(ARCHIVE.sealedSecretKey));
        expect(message).not.toContain(PHOTOS.name);
      }
      expect(await run(records.list)).toEqual([ARCHIVE]);
    });

    it.each([
      ["reading", (records: Records) => records.read(PHOTOS.id)],
      ["removing", (records: Records) => records.remove(PHOTOS.id)],
    ])(
      "One contract on both databases: %s an unknown id fails with a not-found error",
      async (_what, operation) => {
        const { records } = await harness.empty();
        await run(records.save(ARCHIVE));
        const error = await failure(operation(records));
        expect(error).toBeInstanceOf(BackendNotFoundError);
        expect(error).toMatchObject({ backendId: PHOTOS.id });
        expect(await run(records.list)).toEqual([ARCHIVE]);
      },
    );

    it("One contract on both databases: removing a record leaves the others", async () => {
      const { records } = await harness.empty();
      for (const record of [NOTES, PHOTOS, ARCHIVE]) {
        await run(records.save(record));
      }
      await run(records.remove(PHOTOS.id));
      expect(await run(records.list)).toEqual([ARCHIVE, NOTES]);
      expect(await failure(records.read(PHOTOS.id))).toBeInstanceOf(BackendNotFoundError);
      expect(await failure(records.remove(PHOTOS.id))).toBeInstanceOf(BackendNotFoundError);
    });

    it("One contract on both databases: a removed record's name can be saved again", async () => {
      const { records } = await harness.empty();
      await run(records.save(PHOTOS));
      await run(records.remove(PHOTOS.id));
      const again = backend(5, PHOTOS.name, "s3", ARCHIVE.config, ARCHIVE.sealedSecretKey);
      await run(records.save(again));
      expect(await run(records.list)).toEqual([again]);
    });

    it("Records after a restart", async () => {
      const database = await harness.empty();
      await run(database.records.save(ARCHIVE));
      await run(database.records.save(NOTES));
      const restarted = await database.restart();
      expect(await run(restarted.list)).toEqual([ARCHIVE, NOTES]);
      expect(await run(restarted.read(ARCHIVE.id))).toEqual(ARCHIVE);
    });
  });
};

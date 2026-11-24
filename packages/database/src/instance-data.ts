import {
  OPERATION_RETENTION_MS,
  type HourCount,
  type OperationBatch,
  type OperationErrorRecord,
} from "@davloom/core";
import { desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Atomic } from "./archive";
import type { Database } from "./repositories";
import * as schema from "./schema";

// The Instance Settings and Operation Log Ports on the instance database.

/** The Instance Settings Port: one row per key, its value as JSON. */
export const createSettingsStore = (db: Database) => ({
  get: async (key: string): Promise<unknown> =>
    (
      await db
        .select({ value: schema.settings.value })
        .from(schema.settings)
        .where(eq(schema.settings.key, key))
        .limit(1)
    )[0]?.value,
  set: async (key: string, value: unknown): Promise<void> => {
    const updatedAt = new Date();
    await db
      .insert(schema.settings)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt } });
  },
});

const hours = schema.operationHours;
const errors = schema.operationErrors;

/**
 * The Operation Log Port. A batch is one atomic group of statements: an upsert per hour that adds
 * to the stored counts, the errors, and the removal of what is older than the retention, which
 * touches no row when nothing has aged out.
 */
export const createOperationLog = (db: Database, atomic: Atomic) => ({
  add: async (batch: OperationBatch, now: number): Promise<void> => {
    const cutoff = now - OPERATION_RETENTION_MS;
    const statements: { run: () => unknown }[] = batch.hours.map((hour) =>
      db
        .insert(hours)
        .values(hour)
        .onConflictDoUpdate({
          target: hours.hour,
          set: {
            operations: sql`${hours.operations} + ${hour.operations}`,
            failed: sql`${hours.failed} + ${hour.failed}`,
          },
        }),
    );
    if (batch.errors.length > 0) {
      statements.push(
        db
          .insert(errors)
          .values([...batch.errors])
          .onConflictDoNothing(),
      );
    }
    statements.push(db.delete(errors).where(lt(errors.at, cutoff)));
    statements.push(db.delete(hours).where(lt(hours.hour, cutoff)));
    await atomic(statements);
  },
  read: async (
    since: number,
    errorLimit: number,
  ): Promise<{ hours: HourCount[]; errors: OperationErrorRecord[] }> => {
    const [hourRows, errorRows] = await Promise.all([
      db.select().from(hours).where(gte(hours.hour, since)).orderBy(hours.hour),
      db
        .select()
        .from(errors)
        .where(gte(errors.at, since))
        .orderBy(desc(errors.at))
        .limit(errorLimit),
    ]);
    return { hours: hourRows, errors: errorRows };
  },
});

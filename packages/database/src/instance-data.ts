import {
  OPERATION_RETENTION_MS,
  isAuditAction,
  isAuditOutcome,
  type AuditCursor,
  type AuditRecord,
  type HourCount,
  type OperationBatch,
  type OperationErrorRecord,
} from "@davloom/core";
import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import type { Atomic } from "./archive";
import type { Database } from "./repositories";
import * as schema from "./schema";

// The Instance Settings, Operation Log and Audit Log Ports on the instance database.

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

const audit = schema.auditEvents;

/**
 * The Audit Log Port. Events go in one atomic group of statements with the removal of what is
 * older than the cutoff, which touches no row when nothing has aged out. A counted event whose id
 * is kept adds its count to the kept one.
 */
export const createAuditLog = (db: Database, atomic: Atomic) => ({
  add: async (events: readonly AuditRecord[], cutoff: number): Promise<void> => {
    const statements: { run: () => unknown }[] = [];
    if (events.length > 0) {
      statements.push(
        db
          .insert(audit)
          .values([...events])
          .onConflictDoUpdate({
            target: audit.id,
            set: { count: sql`${audit.count} + excluded.count` },
          }),
      );
    }
    statements.push(db.delete(audit).where(lt(audit.at, cutoff)));
    await atomic(statements);
  },
  list: async (cursor: AuditCursor | null, limit: number): Promise<AuditRecord[]> => {
    const rows = await db
      .select()
      .from(audit)
      .where(
        cursor === null
          ? undefined
          : or(lt(audit.at, cursor.at), and(eq(audit.at, cursor.at), lt(audit.id, cursor.id))),
      )
      .orderBy(desc(audit.at), desc(audit.id))
      .limit(limit);
    // A row of an action or outcome this release does not know, as a later release may write,
    // is left out rather than shown as something else.
    return rows.flatMap(({ action, outcome, ...row }) =>
      isAuditAction(action) && isAuditOutcome(outcome) ? [{ ...row, action, outcome }] : [],
    );
  },
});

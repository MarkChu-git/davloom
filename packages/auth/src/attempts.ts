import type { Database } from "@davloom/database/repositories";
import { verificationAttempts as t } from "@davloom/database/schema";
import { eq, sql } from "drizzle-orm";

// Failed proofs of presence, counted per user in Davloom's own table `verification_attempts`, so
// every Worker isolate and every Bun process counts the same attempts, and nothing Better Auth
// prunes can lift a lock early. Better Auth locks the second step of a sign-in itself, but not a
// code checked for a signed-in session, and not Davloom's step-up verification, so those count
// here: a password or an authenticator code that a session sends.
//
// Each attempt is counted before it is checked, in one statement, so attempts sent at once cannot
// pass the limit together; a proof that succeeds clears the count. Wrong attempts within LOCK_MS of
// each other add up; the one that reaches MAX_ATTEMPTS starts the lock, and attempts during the
// lock neither pass nor extend it.

/** Attempts a user may make before the lock. */
export const MAX_ATTEMPTS = 5;
/** How long the lock lasts after the attempt that reached the limit. */
export const LOCK_MS = 15 * 60_000;

export interface Attempts {
  /**
   * Counts an attempt of the user's, and whether it may go ahead: false while the user is locked
   * out, after MAX_ATTEMPTS attempts that did not succeed within LOCK_MS of each other.
   */
  readonly take: (userId: string, now?: number) => Promise<boolean>;
  /** Forgets the user's attempts, after one succeeded. */
  readonly clear: (userId: string) => Promise<void>;
}

export const createAttempts = (db: Database): Attempts => ({
  take: async (userId, now = Date.now()) => {
    // A count older than LOCK_MS starts again at 1. Otherwise the count goes up by one, and the
    // time moves only while the count is below the limit, so the lock lasts LOCK_MS from the
    // attempt that reached it. An attempt passes when its count is within the limit.
    const expired = sql`${now} - ${t.lastAttempt} >= ${LOCK_MS}`;
    const [row] = await db
      .insert(t)
      .values({ userId, count: 1, lastAttempt: now })
      .onConflictDoUpdate({
        target: t.userId,
        set: {
          count: sql`CASE WHEN ${expired} THEN 1 ELSE ${t.count} + 1 END`,
          lastAttempt: sql`CASE WHEN ${expired} OR ${t.count} < ${MAX_ATTEMPTS} THEN ${now} ELSE ${t.lastAttempt} END`,
        },
      })
      .returning({ count: t.count });
    return row !== undefined && row.count <= MAX_ATTEMPTS;
  },
  clear: async (userId) => {
    await db.delete(t).where(eq(t.userId, userId));
  },
});

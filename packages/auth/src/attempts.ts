import type { Auth } from "./auth";

// Failed proofs of presence, counted per user in Better Auth's rate-limit table, so every Worker
// isolate and every Bun process counts the same attempts. Better Auth locks the second step of a
// sign-in itself, but not a code checked for a signed-in session, and not Davloom's step-up
// verification, so those count here: a password or an authenticator code that a session sends.
//
// Each attempt is counted before it is checked, with one guarded increment, so attempts sent at
// once cannot pass the limit together; a proof that succeeds clears the count.

/** Attempts a user may make before the lock. */
export const MAX_ATTEMPTS = 5;
/** How long the lock lasts after the attempt that reached the limit. */
export const LOCK_MS = 15 * 60_000;

const MODEL = "rateLimit";

interface Row {
  readonly key: string;
  readonly count: number;
  readonly lastRequest: number;
}

/** Better Auth's database adapter, from its context or from a hook's. */
export type Adapter = Awaited<Auth["$context"]>["adapter"];

const keyOf = (userId: string) => `davloom:presence:${userId}`;

const read = (adapter: Adapter, key: string): Promise<Row | null> =>
  adapter.findOne<Row>({ model: MODEL, where: [{ field: "key", value: key }] });

/**
 * Counts an attempt of the user's, and whether it may go ahead: false while the user is locked
 * out, after MAX_ATTEMPTS attempts that did not succeed within LOCK_MS of each other.
 */
export const takeAttempt = async (
  adapter: Adapter,
  userId: string,
  now = Date.now(),
): Promise<boolean> => {
  const key = keyOf(userId);
  // Each pass either writes or finds the row changed by another attempt; a few passes settle it.
  for (let pass = 0; pass < 4; pass += 1) {
    const row = await read(adapter, key);
    if (row === null) {
      try {
        await adapter.create({ model: MODEL, data: { key, count: 1, lastRequest: now } });
        return true;
      } catch {
        continue;
      }
    }
    if (now - row.lastRequest >= LOCK_MS) {
      const reset = await adapter.incrementOne({
        model: MODEL,
        where: [
          { field: "key", value: key },
          { field: "lastRequest", operator: "lte", value: row.lastRequest },
        ],
        increment: {},
        set: { count: 1, lastRequest: now },
      });
      if (reset) return true;
      continue;
    }
    const counted = await adapter.incrementOne({
      model: MODEL,
      where: [
        { field: "key", value: key },
        { field: "count", operator: "lt", value: MAX_ATTEMPTS },
      ],
      increment: { count: 1 },
      set: { lastRequest: now },
    });
    if (counted) return true;
    const again = await read(adapter, key);
    if (again === null || now - again.lastRequest >= LOCK_MS) continue;
    return false;
  }
  return false;
};

/** Forgets the user's attempts, after one succeeded. */
export const clearAttempts = async (adapter: Adapter, userId: string): Promise<void> => {
  await adapter.delete({ model: MODEL, where: [{ field: "key", value: keyOf(userId) }] });
};

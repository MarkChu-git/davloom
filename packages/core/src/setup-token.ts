import { Effect, Redacted } from "effect";

// The optional setup token (DAVLOOM_SETUP_TOKEN) that registering the owner, or importing in its
// place, has to name when the deployment sets one. Both values are hashed first, so the compare
// takes the same time whatever the tokens' lengths and wherever they differ.

const digest = (value: string) =>
  Effect.promise(
    async () =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  );

/** The setup token a deployment variable sets, or null when it is unset or blank. */
export const setupTokenFrom = (value: string | undefined): Redacted.Redacted | null =>
  value === undefined || value.trim() === "" ? null : Redacted.make(value.trim());

/** Whether `given` is the deployment's setup token; true when the deployment sets none. */
export const setupTokenMatches = (
  expected: Redacted.Redacted | null | undefined,
  given: string,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (expected === null || expected === undefined) return true;
    const want = yield* digest(Redacted.value(expected));
    const got = yield* digest(given);
    let difference = 0;
    for (let index = 0; index < want.length; index += 1) {
      difference |= (want[index] ?? 0) ^ (got[index] ?? 0);
    }
    return difference === 0;
  });

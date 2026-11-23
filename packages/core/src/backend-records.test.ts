import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { BackendNameTakenError, BackendNotFoundError } from "./backend-records";

// The errors of the backend records Port. packages/database raises them, and its tests and the
// database contract suite check when; these check what each error carries.
describe("the backend records errors", () => {
  it("a name-taken error names the backend in quotes", () => {
    const error = new BackendNameTakenError({ backendName: "My Photos" });
    expect(error).toMatchObject({ _tag: "BackendNameTakenError", backendName: "My Photos" });
    expect(error.message).toBe('A storage backend named "My Photos" already exists.');
  });

  it("a not-found error names the id", () => {
    const error = new BackendNotFoundError({ backendId: "0193f3c2-7a11-7d42-9d2c-1c2b3a4d5e6f" });
    expect(error).toMatchObject({
      _tag: "BackendNotFoundError",
      backendId: "0193f3c2-7a11-7d42-9d2c-1c2b3a4d5e6f",
    });
    expect(error.message).toBe(
      "No storage backend has the id 0193f3c2-7a11-7d42-9d2c-1c2b3a4d5e6f.",
    );
  });

  it.each([
    ["a name-taken error", new BackendNameTakenError({ backendName: "Photos" })],
    ["a not-found error", new BackendNotFoundError({ backendId: "missing" })],
  ])("%s fails the effect that yields it, as a typed error", (_what, error) => {
    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        return yield* error;
      }),
    );
    expect(exit).toEqual(Exit.fail(error));
  });
});

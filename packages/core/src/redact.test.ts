import { describe, expect, it } from "vitest";
import { redactedError, redactedStack } from "./redact";

const named = (name: string, message: string, extra: object = {}, cause?: unknown) =>
  Object.assign(new Error(message, cause === undefined ? {} : { cause }), { name }, extra);

describe("redactedError", () => {
  it.each([
    ["a plain error", new Error("secret value"), "Error"],
    ["a string", "params: secret", "string"],
    ["undefined", undefined, "undefined"],
    ["an object", { message: "secret" }, "object"],
    [
      "an error with a code",
      named("SqliteError", "secret", { code: "SQLITE_BUSY" }),
      "SqliteError (SQLITE_BUSY)",
    ],
    [
      "a code that is not a constant",
      named("SqliteError", "x", { code: "params: secret" }),
      "SqliteError",
    ],
    ["a numeric code", named("D1Error", "x", { code: 7 }), "D1Error"],
    ["a name with a message in it", named("Error: params secret", "x"), "Error"],
    [
      "a chain of causes",
      named(
        "DrizzleQueryError",
        "params: hash",
        {},
        named("SqliteError", "secret", { code: "SQLITE_CONSTRAINT" }),
      ),
      "DrizzleQueryError <- SqliteError (SQLITE_CONSTRAINT)",
    ],
    [
      "a cause that is not an error",
      new Error("x", { cause: "params: secret" }),
      "Error <- string",
    ],
  ])("names %s without its message", (_case, error, expected) => {
    expect(redactedError(error)).toBe(expected);
  });

  it("stops at a cause that refers to itself", () => {
    const error = new Error("secret");
    (error as { cause?: unknown }).cause = error;
    expect(redactedError(error).split(" <- ")).toHaveLength(8);
  });
});

describe("redactedStack", () => {
  it("keeps the frames and drops the message", () => {
    const error = new Error("params: secret\nsecond line of the message");
    const stack = redactedStack(error);
    expect(stack).not.toMatch(/secret|second line/);
    expect(stack).toMatch(/^\s+at /);
  });

  it("is empty for what is not an error", () => {
    expect(redactedStack("params: secret")).toBe("");
  });
});

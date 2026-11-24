import { Database } from "bun:sqlite";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "@davloom/database/bun-sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth, logRedacted } from "./auth";
import { createIdentity } from "./identity";

// What Better Auth may write to the log: errors by their class and code alone, since a database's
// error can name the values its query was bound to.

afterEach(() => {
  vi.restoreAllMocks();
});

const SECRET_VALUE = "bound-token-9a8b7c6d5e4f";

const captured = () => {
  const lines: string[] = [];
  const keep = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "error").mockImplementation(keep);
  vi.spyOn(console, "warn").mockImplementation(keep);
  vi.spyOn(console, "log").mockImplementation(keep);
  return lines;
};

describe("logRedacted", () => {
  it.each([
    ["error", "Invalid password", [], "[Better Auth] error: Invalid password"],
    [
      "warn",
      "Rate limiting could not determine a client IP.",
      [],
      "[Better Auth] warn: Rate limiting could not determine a client IP.",
    ],
    [
      "error",
      `no such table: session ${SECRET_VALUE}`,
      [],
      "[Better Auth] error: (message withheld)",
    ],
    [
      "error",
      "INTERNAL_SERVER_ERROR",
      [Object.assign(new Error(`params: ${SECRET_VALUE}`), { name: "DrizzleQueryError" })],
      "[Better Auth] error: (message withheld) DrizzleQueryError",
    ],
    ["error", "Failed", [SECRET_VALUE], "[Better Auth] error: Failed string"],
  ] as const)("%s %j", (level, message, args, line) => {
    const lines = captured();
    logRedacted(level, message, ...args);
    expect(lines).toEqual([line]);
  });
});

describe("the handler of Better Auth's routes", () => {
  it("answers a database failure with 500, and logs it without the values it was bound to", async () => {
    const sqlite = new Database(":memory:");
    const db = createBunSqliteDatabase(sqlite);
    migrateBunSqliteDatabase(db);
    const auth = createAuth({
      database: db,
      secret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost",
      checkLeakedPasswords: false,
      rateLimit: false,
    });
    const registered = await createIdentity(auth).registerOwner({
      username: "ada",
      name: "A",
      email: null,
      password: "a long password nobody has used",
    });
    expect(registered.ok).toBe(true);
    sqlite.exec(
      `CREATE TRIGGER refuse BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT, '${SECRET_VALUE} ' || NEW.token); END;`,
    );
    const lines = captured();
    const response = await auth.handler(
      new Request("http://localhost/api/auth/sign-in/username", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ username: "ada", password: "a long password nobody has used" }),
      }),
    );
    expect(response.status).toBe(500);
    expect(lines.join("\n")).not.toContain(SECRET_VALUE);
    expect(lines.join("\n")).toContain("SQLITE_CONSTRAINT_TRIGGER");
  });
});

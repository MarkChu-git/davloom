// The test runs on Bun SQLite, so it needs Bun's types; the package itself keeps `types: []`.
/// <reference types="bun" />
import { Database } from "bun:sqlite";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "@davloom/database/bun-sqlite";
import * as schema from "@davloom/database/schema";
import { getSessionFromCtx } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS } from "./attempts";
import { createAuth } from "./auth";
import { createIdentity } from "./identity";
import { cookieHeader, totpCode, totpSecretOf } from "./testing";

// A session that ends, signed out from another tab, while its authenticator code is checked: the
// code was right, but no session is left whose attempts could be cleared, and the count stays.
// auth.ts reads the session through Better Auth's getSessionFromCtx, which this file wraps so a
// test can end the session between the check and the hook that runs after it.

const ended = vi.hoisted(() => ({ now: false }));

vi.mock("better-auth/api", async (original) => {
  const actual = await original<typeof import("better-auth/api")>();
  return {
    ...actual,
    getSessionFromCtx: vi.fn((...args: Parameters<typeof actual.getSessionFromCtx>) =>
      ended.now ? Promise.resolve(null) : actual.getSessionFromCtx(...args),
    ),
  };
});

const PASSWORD = "a long password nobody has used";

describe("a session that ends while its code is checked", () => {
  it("keeps the count of wrong attempts", async () => {
    const db = createBunSqliteDatabase(new Database(":memory:"));
    migrateBunSqliteDatabase(db);
    const auth = createAuth({
      database: db,
      secret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost",
      checkLeakedPasswords: false,
      rateLimit: false,
    });
    await createIdentity(auth).registerOwner({
      username: "ada",
      name: "Ada",
      email: null,
      password: PASSWORD,
    });
    const signedIn = await auth.api.signInUsername({
      body: { username: "ada", password: PASSWORD },
      asResponse: true,
    });
    let headers = new Headers({ cookie: cookieHeader(signedIn) });
    const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });
    if (enabled.method !== "totp") throw new Error("no TOTP");
    const secret = totpSecretOf(enabled.totpURI);
    const verified = await auth.api.verifyTOTP({
      body: { code: await totpCode(secret) },
      headers,
      asResponse: true,
    });
    headers = new Headers({ cookie: cookieHeader(verified) });
    const http = (code: string) => {
      const sent = new Headers(headers);
      sent.set("content-type", "application/json");
      sent.set("origin", "http://localhost");
      return auth.handler(
        new Request("http://localhost/api/auth/two-factor/verify-totp", {
          method: "POST",
          headers: sent,
          body: JSON.stringify({ code }),
        }),
      );
    };
    const wrongCode = (await totpCode(secret)) === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < MAX_ATTEMPTS - 1; attempt += 1) {
      expect((await http(wrongCode)).status).toBe(401);
    }

    // The hook before the route counts the attempt with the session; the one after finds none.
    const calls = vi.mocked(getSessionFromCtx).mock.calls.length;
    vi.mocked(getSessionFromCtx).mockImplementationOnce(async (...args) => {
      const actual = await vi.importActual<typeof import("better-auth/api")>("better-auth/api");
      const found = await actual.getSessionFromCtx(...args);
      ended.now = true;
      return found;
    });
    expect((await http(await totpCode(secret))).status).toBe(200);
    expect(vi.mocked(getSessionFromCtx).mock.calls.length).toBe(calls + 2);
    expect(await db.select().from(schema.verificationAttempts)).toMatchObject([
      { count: MAX_ATTEMPTS },
    ]);
  });
});

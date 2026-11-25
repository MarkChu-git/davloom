import { describe, expect, it } from "vitest";
import { authAuditEntry } from "./app";
import { AUTH_ACTIONS } from "./verification";

// Which Better Auth answers the audit trail records (app.ts authAuditEntry), from the path, the
// request's cookies and the answer.

const SECOND_STEP = "better-auth.two_factor=abc.sig";
const SECURE_SECOND_STEP = "a=1; __Secure-better-auth.two_factor=abc.sig";

const answer = (status: number, body: unknown = {}) => Response.json(body, { status });
const request = (cookie = "") =>
  new Request("https://davloom.test/api/auth/x", { method: "POST", headers: { cookie } });

const SIGN_IN_PATHS = ["/sign-in/email", "/sign-in/username"] as const;

/** A path, the request's cookies, the answer's status and body, and the event, or null. */
type Case = [string, string, number, unknown, Record<string, unknown> | null];

describe("authAuditEntry", () => {
  it.each<Case>([
    ...SIGN_IN_PATHS.flatMap((path): Case[] => [
      [path, "", 200, {}, { action: "sign-in", outcome: "success", target: "password" }],
      [path, "", 200, { twoFactorRedirect: true }, null],
      [path, "", 200, { twoFactorRedirect: false }, { action: "sign-in", outcome: "success" }],
      [path, "", 200, "not an object", { action: "sign-in", outcome: "success" }],
      [path, "", 401, {}, { action: "sign-in", outcome: "failure", target: "password" }],
      [path, "", 403, {}, { action: "sign-in", outcome: "failure" }],
      [path, "", 429, {}, null],
      [path, "", 500, {}, null],
      [path, "", 503, {}, null],
    ]),
    [
      "/two-factor/verify-totp",
      SECOND_STEP,
      200,
      {},
      { outcome: "success", target: "authenticator" },
    ],
    ["/two-factor/verify-totp", SECURE_SECOND_STEP, 401, {}, { outcome: "failure" }],
    ["/two-factor/verify-totp", "", 200, {}, { action: "two-factor", target: "enabled" }],
    ["/two-factor/verify-totp", "", 401, {}, null],
    ["/two-factor/verify-totp", "notbetter-auth.two_factor=x", 200, {}, { action: "two-factor" }],
    ["/two-factor/verify-backup-code", SECOND_STEP, 200, {}, { target: "backup code" }],
    ["/two-factor/verify-backup-code", SECOND_STEP, 401, {}, { outcome: "failure" }],
    ["/two-factor/verify-backup-code", "", 200, {}, null],
    ["/passkey/verify-authentication", "", 200, {}, { action: "sign-in", target: "passkey" }],
    ["/passkey/verify-authentication", "", 400, {}, { outcome: "failure", target: "passkey" }],
    ["/sign-out", "", 200, {}, { action: "sign-out" }],
    ["/sign-out", "", 401, {}, null],
    ["/change-password", "", 200, {}, { action: "password" }],
    ["/change-password", "", 400, {}, null],
    ["/change-email", "", 200, {}, { action: "email" }],
    ["/two-factor/disable", "", 200, {}, { action: "two-factor", target: "disabled" }],
    ["/two-factor/generate-backup-codes", "", 200, {}, { target: "backup codes" }],
    ["/two-factor/enable", "", 200, {}, null],
    ["/passkey/verify-registration", "", 200, {}, { action: "passkey", target: "added" }],
    ["/passkey/update-passkey", "", 200, {}, { action: "passkey", target: "renamed" }],
    ["/passkey/delete-passkey", "", 200, {}, { action: "passkey", target: "removed" }],
    ["/revoke-session", "", 200, {}, { action: "sessions", target: "one" }],
    ["/revoke-sessions", "", 200, {}, { action: "sessions", target: "all" }],
    ["/revoke-other-sessions", "", 200, {}, { action: "sessions", target: "others" }],
    ["/get-session", "", 200, {}, null],
    ["/list-sessions", "", 200, {}, null],
    ["/update-user", "", 200, {}, null],
    ["/toString", "", 200, {}, null],
    ["/constructor", "", 200, {}, null],
  ])("%s with cookie %j answering %i %j records %j", async (path, cookie, status, body, entry) => {
    const recorded = await authAuditEntry(path, request(cookie), answer(status, body));
    if (entry === null) expect(recorded).toBeNull();
    else expect(recorded).toMatchObject(entry);
  });

  it("leaves the answer's body for the client to read", async () => {
    const response = answer(200, { token: "t" });
    await authAuditEntry("/sign-in/username", request(), response);
    expect(await response.json()).toEqual({ token: "t" });
  });

  it("records only paths that verification.ts lets through", async () => {
    for (const path of ["/sign-up/email", "/api-key/create", "/admin/ban-user"]) {
      expect(Object.hasOwn(AUTH_ACTIONS, path)).toBe(false);
      expect(await authAuditEntry(path, request(), answer(200))).toBeNull();
    }
  });
});

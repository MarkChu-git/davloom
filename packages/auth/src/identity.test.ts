// The test runs on Bun SQLite, so it needs Bun's types; the package itself keeps `types: []`.
/// <reference types="bun" />
import { Database } from "bun:sqlite";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "@davloom/database/bun-sqlite";
import * as schema from "@davloom/database/schema";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCK_MS, MAX_ATTEMPTS } from "./attempts";
import {
  configuredOrigin,
  createAdmin,
  createAuth,
  PLACEHOLDER_EMAIL_DOMAIN,
  publicEmail,
  rateLimitFrom,
} from "./auth";
import { createIdentity } from "./identity";
import { cookieHeader, totpCode, totpSecretOf } from "./testing";

// The Identity Port on Better Auth over a migrated in-memory Bun SQLite database. The leaked
// password check is off unless a test turns it on with a fake Have I Been Pwned.

const OWNER = {
  username: "Ada",
  name: "Ada Lovelace",
  email: null,
  password: "a long password nobody has used",
};

let db: ReturnType<typeof createBunSqliteDatabase>;
let auth: ReturnType<typeof createAuth>;
let identity: ReturnType<typeof createIdentity>;

const setUp = (checkLeakedPasswords = false) => {
  db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  auth = createAuth({
    database: db,
    secret: "a-test-secret-that-is-at-least-32-characters",
    baseURL: "http://localhost",
    checkLeakedPasswords,
  });
  identity = createIdentity(auth);
};

beforeEach(() => setUp());
afterEach(() => {
  vi.unstubAllGlobals();
});

const signIn = (username: string, password: string) =>
  auth.api.signInUsername({ body: { username, password }, asResponse: true });

const sessionOf = async (username = OWNER.username, password = OWNER.password) => {
  const response = await signIn(username, password);
  expect(response.status).toBe(200);
  return new Headers({ cookie: cookieHeader(response) });
};

const keyRow = async (id: string) =>
  (await db.select().from(schema.apikey).where(eq(schema.apikey.id, id)))[0];

const register = (overrides: Partial<Parameters<typeof identity.registerOwner>[0]> = {}) =>
  identity.registerOwner({ ...OWNER, ...overrides });

describe("publicEmail", () => {
  it.each([
    ["ada@example.com", "ada@example.com"],
    [`x@${PLACEHOLDER_EMAIL_DOMAIN}`, null],
    [`X@${PLACEHOLDER_EMAIL_DOMAIN.toUpperCase()}`, null],
    [`x@not-${PLACEHOLDER_EMAIL_DOMAIN}`, `x@not-${PLACEHOLDER_EMAIL_DOMAIN}`],
  ])("shows %s as %s", (email, shown) => {
    expect(publicEmail(email)).toBe(shown);
  });
});

describe("registerOwner", () => {
  it("creates the owner, who signs in with the username in any case", async () => {
    const result = await register();

    expect(result.ok).toBe(true);
    const [user] = await db.select().from(schema.user);
    expect(user).toMatchObject({ name: OWNER.name, username: "ada", displayUsername: "Ada" });
    expect(user?.email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)).toBe(true);
    expect((await signIn("ada", OWNER.password)).status).toBe(200);
    expect((await signIn("ADA", OWNER.password)).status).toBe(200);
    expect((await signIn("ada", "not the password at all")).status).toBe(401);
  });

  it("keeps an email the owner gave, who can also sign in with it", async () => {
    await register({ email: "ada@example.com" });

    const response = await auth.api.signInEmail({
      body: { email: "ada@example.com", password: OWNER.password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
  });

  it("closes once an owner exists", async () => {
    await register();

    expect(await register({ username: "mallory" })).toEqual({ ok: false, refusal: "closed" });
    expect(await db.select().from(schema.user)).toHaveLength(1);
  });

  it("lets exactly one of many registrations at once win", async () => {
    const results = await Promise.all(
      ["one", "two", "three", "four", "five"].map((username) => register({ username })),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 4 }, () => ({ ok: false, refusal: "closed" })),
    );
    expect(await db.select().from(schema.user)).toHaveLength(1);
    expect(await db.select().from(schema.account)).toHaveLength(1);
  });

  it.each([
    ["password", { password: "short" }, /short/i],
    ["password", { password: "x".repeat(129) }, /long/i],
    ["username", { username: "a" }, /short/i],
    ["username", { username: "no spaces here" }, /invalid/i],
    ["email", { email: "not an email" }, /email/i],
  ] as const)("refuses a bad %s with Better Auth's reason", async (field, overrides, reason) => {
    const result = await register(overrides);

    expect(result).toMatchObject({ ok: false, refusal: "field", field });
    expect(result.ok ? "" : "reason" in result ? result.reason : "").toMatch(reason);
    expect(await db.select().from(schema.user)).toHaveLength(0);
  });

  it("refuses a password Have I Been Pwned knows", async () => {
    setUp(true);
    const sha1 = new Bun.CryptoHasher("sha1").update(OWNER.password).digest("hex").toUpperCase();
    const fetch = vi.fn(
      async (_url: URL) =>
        new Response(`${sha1.slice(5)}:42\r\n0000000000000000000000000000000000A:1`),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await register();

    expect(result).toMatchObject({ ok: false, refusal: "field", field: "password" });
    expect(result.ok ? "" : "reason" in result ? result.reason : "").toMatch(/breach/);
    // Only the first five characters of the hash leave the instance.
    expect(fetch.mock.calls[0]?.[0].href).toBe(
      `https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`,
    );
  });

  it("accepts a password Have I Been Pwned does not know", async () => {
    setUp(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("0000000000000000000000000000000000A:1")),
    );

    expect((await register()).ok).toBe(true);
  });

  it.each([
    ["the service cannot be reached", () => Promise.reject(new TypeError("fetch failed"))],
    ["the service fails", async () => new Response("down", { status: 503 })],
  ])("refuses, without creating the owner, when %s", async (_case, answer) => {
    setUp(true);
    vi.stubGlobal("fetch", vi.fn(answer));

    expect(await register()).toMatchObject({ ok: false, refusal: "check-failed" });
    expect(await db.select().from(schema.user)).toHaveLength(0);
  });
});

describe("sessionUser", () => {
  it("returns the signed-in owner of a request carrying the session cookie", async () => {
    await register({ email: "ada@example.com" });
    const before = Date.now();

    const user = await identity.sessionUser(await sessionOf());

    expect(user).toMatchObject({
      name: OWNER.name,
      username: "Ada",
      email: "ada@example.com",
      twoFactorEnabled: false,
    });
    expect(user?.verifiedAt).toBeGreaterThanOrEqual(before - 1000);
  });

  it("hides the placeholder email", async () => {
    await register();

    expect((await identity.sessionUser(await sessionOf()))?.email).toBeNull();
  });

  it.each([
    ["no cookie", new Headers()],
    [
      "an unknown session cookie",
      new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
  ])("returns null with %s", async (_case, headers) => {
    await register();

    expect(await identity.sessionUser(headers)).toBeNull();
  });
});

/** Turns two-step verification on for the signed-in owner and returns its TOTP secret. */
const enableTwoFactor = async (headers: Headers) => {
  const enabled = await auth.api.enableTwoFactor({ body: { password: OWNER.password }, headers });
  if (enabled.method !== "totp") throw new Error("two-step verification did not start TOTP");
  const secret = totpSecretOf(enabled.totpURI);
  const verified = await auth.api.verifyTOTP({
    body: { code: await totpCode(secret) },
    headers,
    asResponse: true,
  });
  // Turning it on replaces the session with a new one.
  return { secret, headers: new Headers({ cookie: cookieHeader(verified) }) };
};

describe("reverify", () => {
  it("moves verifiedAt forward with the right password", async () => {
    await register();
    const headers = await sessionOf();
    const [row] = await db.select().from(schema.session);
    expect(row?.verifiedAt).toBeNull();

    expect(await identity.reverify(headers, { password: OWNER.password, code: "" })).toBe(
      "verified",
    );

    const [after] = await db.select().from(schema.session);
    expect(after?.verifiedAt?.getTime()).toBeGreaterThanOrEqual(row?.createdAt.getTime() ?? 0);
  });

  it.each([
    ["a wrong password", "not the password at all", "wrong-password"],
    ["an empty password", "", "wrong-password"],
  ] as const)("refuses %s", async (_case, password, expected) => {
    await register();

    expect(await identity.reverify(await sessionOf(), { password, code: "" })).toBe(expected);
  });

  it("needs a session", async () => {
    await register();

    expect(await identity.reverify(new Headers(), { password: OWNER.password, code: "" })).toBe(
      "no-session",
    );
  });

  it("asks for the authenticator code when two-step verification is on", async () => {
    await register();
    const { secret, headers } = await enableTwoFactor(await sessionOf());

    expect(await identity.reverify(headers, { password: OWNER.password, code: "" })).toBe(
      "code-required",
    );
    expect(await identity.reverify(headers, { password: OWNER.password, code: "000000" })).toBe(
      (await totpCode(secret)) === "000000" ? "verified" : "wrong-code",
    );
    expect(
      await identity.reverify(headers, { password: OWNER.password, code: await totpCode(secret) }),
    ).toBe("verified");
    expect((await identity.sessionUser(headers))?.twoFactorEnabled).toBe(true);
  });
});

const WRONG = { password: "not the password at all", code: "" };

/** A request to Better Auth's own routes over HTTP, as the Dashboard sends it. */
const http = (path: string, body: unknown, headers = new Headers()) => {
  const sent = new Headers(headers);
  sent.set("content-type", "application/json");
  sent.set("origin", "http://localhost");
  return auth.handler(
    new Request(`http://localhost/api/auth${path}`, {
      method: "POST",
      headers: sent,
      body: JSON.stringify(body),
    }),
  );
};

describe("locking re-verification", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("locks after five wrong passwords, even for the right one, for 15 minutes", async () => {
    await register();
    const headers = await sessionOf();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(await identity.reverify(headers, WRONG)).toBe("wrong-password");
    }
    expect(await identity.reverify(headers, { password: OWNER.password, code: "" })).toBe("locked");

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + LOCK_MS - 1000 });
    expect(await identity.reverify(headers, { password: OWNER.password, code: "" })).toBe("locked");
    vi.setSystemTime(Date.now() + 2000);
    expect(await identity.reverify(headers, { password: OWNER.password, code: "" })).toBe(
      "verified",
    );
  });

  it("forgets wrong attempts once one succeeds", async () => {
    await register();
    const headers = await sessionOf();
    for (let round = 0; round < 3; round += 1) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS - 1; attempt += 1) {
        expect(await identity.reverify(headers, WRONG)).toBe("wrong-password");
      }
      expect(await identity.reverify(headers, { password: OWNER.password, code: "" })).toBe(
        "verified",
      );
    }
  });

  it("lets no more than five of many attempts sent at once through", async () => {
    await register();
    const headers = await sessionOf();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => identity.reverify(headers, WRONG)),
    );
    expect(results.filter((result) => result === "wrong-password").length).toBeLessThanOrEqual(
      MAX_ATTEMPTS,
    );
    expect(results).toContain("locked");
  });

  it("counts wrong authenticator codes too", async () => {
    await register();
    const { secret, headers } = await enableTwoFactor(await sessionOf());
    const wrongCode = (await totpCode(secret)) === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(await identity.reverify(headers, { password: OWNER.password, code: wrongCode })).toBe(
        "wrong-code",
      );
    }
    expect(
      await identity.reverify(headers, { password: OWNER.password, code: await totpCode(secret) }),
    ).toBe("locked");
  });

  it("counts codes a signed-in session sends to Better Auth over HTTP", async () => {
    await register();
    const headers = await sessionOf();
    const enabled = await auth.api.enableTwoFactor({ body: { password: OWNER.password }, headers });
    if (enabled.method !== "totp") throw new Error("no TOTP");
    const secret = totpSecretOf(enabled.totpURI);
    const wrongCode = (await totpCode(secret)) === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect((await http("/two-factor/verify-totp", { code: wrongCode }, headers)).status).toBe(
        401,
      );
    }
    const locked = await http("/two-factor/verify-totp", { code: await totpCode(secret) }, headers);
    expect(locked.status).toBe(429);
    expect((await identity.sessionUser(headers))?.twoFactorEnabled).toBe(false);
  });

  it("keeps the lock when Better Auth prunes its rate limit", async () => {
    db = createBunSqliteDatabase(new Database(":memory:"));
    migrateBunSqliteDatabase(db);
    auth = createAuth({
      database: db,
      secret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost",
      checkLeakedPasswords: false,
      clientIpHeaders: ["x-client-ip"],
    });
    identity = createIdentity(auth);
    await register();
    const headers = await sessionOf();
    // Five wrong passwords two minutes ago: the lock holds for 13 minutes more.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() - 120_000 });
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(await identity.reverify(headers, WRONG)).toBe("wrong-password");
    }
    vi.useRealTimers();
    // A bucket of Better Auth's that resets prunes every row older than its longest window.
    const ok = () =>
      auth.handler(
        new Request("http://localhost/api/auth/ok", { headers: { "x-client-ip": "1.2.3.4" } }),
      );
    expect((await ok()).status).toBe(200);
    await db
      .update(schema.rateLimit)
      .set({ lastRequest: Date.now() - 120_000 })
      .where(eq(schema.rateLimit.key, "1.2.3.4|/ok"));
    expect((await ok()).status).toBe(200);
    await new Promise((done) => setTimeout(done, 50));
    expect(await identity.reverify(headers, { password: OWNER.password, code: "" })).toBe("locked");
  });

  it("starts a lock at the attempt that reaches the limit, and attempts during it do not extend it", async () => {
    const start = 1_800_000_000_000;
    expect(await auth.attempts.take("u", start)).toBe(true);
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(await auth.attempts.take("u", start + attempt)).toBe(true);
    }
    const locked = start + MAX_ATTEMPTS - 1;
    expect(await auth.attempts.take("u", locked)).toBe(false);
    expect(await auth.attempts.take("u", locked + LOCK_MS - 1)).toBe(false);
    expect(await auth.attempts.take("u", locked + LOCK_MS)).toBe(true);
    await auth.attempts.clear("u");
    expect(await auth.attempts.take("u", locked + LOCK_MS + 1)).toBe(true);
  });

  it("counts by user, so another user's lock leaves the owner alone", async () => {
    await register();
    const headers = await sessionOf();
    for (let attempt = 0; attempt < MAX_ATTEMPTS + 2; attempt += 1) {
      await auth.attempts.take("someone-else");
    }
    expect(await identity.reverify(headers, { password: OWNER.password, code: "" })).toBe(
      "verified",
    );
  });
});

describe("Better Auth's rate limit", () => {
  it("limits sign-in over HTTP, outside production too", async () => {
    await register();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await http("/sign-in/username", {
        username: OWNER.username,
        password: "not the password at all",
      });
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(10);
    expect((await db.select().from(schema.rateLimit)).length).toBeGreaterThan(0);
  });

  it("is off when the deployment says so", async () => {
    db = createBunSqliteDatabase(new Database(":memory:"));
    migrateBunSqliteDatabase(db);
    auth = createAuth({
      database: db,
      secret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost",
      checkLeakedPasswords: false,
      rateLimit: false,
    });
    identity = createIdentity(auth);
    await register();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await http("/sign-in/username", {
        username: OWNER.username,
        password: "not the password at all",
      });
      expect(response.status).toBe(401);
    }
  });

  it.each([
    [undefined, true],
    ["", true],
    ["on", true],
    ["off", false],
    [" OFF ", false],
    ["0", false],
    ["false", false],
    ["no", false],
  ])("DAVLOOM_AUTH_RATE_LIMIT=%j leaves it on: %s", (value, on) => {
    expect(rateLimitFrom(value)).toBe(on);
  });
});

describe("passkeys", () => {
  it("are off without a configured origin", async () => {
    const response = await http("/passkey/generate-authenticate-options", {});
    expect(response.status).toBe(404);
  });

  it("are bound to the configured origin, not to the request's", async () => {
    db = createBunSqliteDatabase(new Database(":memory:"));
    migrateBunSqliteDatabase(db);
    auth = createAuth({
      database: db,
      secret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost",
      checkLeakedPasswords: false,
      passkeyOrigin: "https://files.example.com",
    });
    const response = await auth.handler(
      new Request("https://evil.example/api/auth/passkey/generate-authenticate-options", {
        headers: { origin: "https://evil.example", host: "evil.example" },
      }),
    );
    expect(await response.json()).toMatchObject({ rpId: "files.example.com" });
  });

  it.each([
    [undefined, undefined],
    ["", undefined],
    ["not a url", undefined],
    ["ftp://files.example.com", undefined],
    ["https://files.example.com/dav/", "https://files.example.com"],
    [" http://127.0.0.1:3000 ", "http://127.0.0.1:3000"],
  ])("DAVLOOM_URL=%j names the origin %j", (value, origin) => {
    expect(configuredOrigin(value)).toBe(origin);
  });
});

describe("two-step sign-in", () => {
  it("asks for the code after the password, and starts a session only with it", async () => {
    await register();
    const { secret } = await enableTwoFactor(await sessionOf());

    const first = await signIn(OWNER.username, OWNER.password);
    expect(await first.clone().json()).toMatchObject({ twoFactorRedirect: true });
    const pending = new Headers({ cookie: cookieHeader(first) });
    expect(await identity.sessionUser(pending)).toBeNull();

    const second = await auth.api.verifyTOTP({
      body: { code: await totpCode(secret) },
      headers: pending,
      asResponse: true,
    });
    expect(second.status).toBe(200);
    const user = await identity.sessionUser(new Headers({ cookie: cookieHeader(second) }));
    expect(user?.username).toBe("Ada");
  });
});

describe("createAdmin", () => {
  it("creates a verified user who can sign in with the password", async () => {
    const user = await createAdmin(auth, {
      name: "Admin",
      email: "admin@davloom.test",
      password: "correct horse battery",
      username: "Admin",
    });

    expect((await signIn("admin", "correct horse battery")).status).toBe(200);
    expect(user.emailVerified).toBe(true);
  });
});

const ownerId = async () => {
  const result = await register();
  if (!result.ok) throw new Error("no owner");
  return result.id;
};

describe("createApiKey", () => {
  it.each([
    ["read-only", 86_400],
    ["read-write", 30 * 86_400],
  ] as const)("creates a %s key that expires after %i seconds", async (access, expiresIn) => {
    const userId = await ownerId();
    const before = Date.now();

    const created = await identity.createApiKey({
      userId,
      name: "Laptop",
      expiresIn,
      metadata: { access },
    });

    expect(created.key.startsWith("dav_")).toBe(true);
    expect(created.key.length).toBeGreaterThan("dav_".length + 16);
    const row = await keyRow(created.id);
    expect(row).toMatchObject({ name: "Laptop", referenceId: userId, prefix: "dav_" });
    expect(row?.start).toBe(created.key.slice(0, 10));
    // Only a hash of the key is stored.
    expect(row?.key).not.toBe(created.key);
    expect(row?.metadata === null ? null : JSON.parse(row?.metadata ?? "")).toEqual({ access });
    const expiresAt = row?.expiresAt?.getTime() ?? 0;
    expect(expiresAt).toBeGreaterThanOrEqual(before + expiresIn * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + expiresIn * 1000);
  });

  it("creates a key that never expires when expiresIn is null", async () => {
    const userId = await ownerId();

    const created = await identity.createApiKey({
      userId,
      name: "Server",
      expiresIn: null,
      metadata: { access: "read-write" },
    });

    expect(created.key.startsWith("dav_")).toBe(true);
    expect((await keyRow(created.id))?.expiresAt).toBeNull();
  });

  it("gives every key a different secret", async () => {
    const userId = await ownerId();
    const details = {
      userId,
      name: "Phone",
      expiresIn: null,
      metadata: { access: "read-only" },
    } as const;

    const first = await identity.createApiKey(details);
    const second = await identity.createApiKey(details);

    expect(first.key).not.toBe(second.key);
    expect(first.id).not.toBe(second.id);
  });
});

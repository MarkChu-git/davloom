// The test runs on Bun SQLite, so it needs Bun's types; the package itself keeps `types: []`.
/// <reference types="bun" />
import { Database } from "bun:sqlite";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "@davloom/database/bun-sqlite";
import * as schema from "@davloom/database/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "./auth";
import { createIdentity } from "./identity";

// The Identity Port on Better Auth over a migrated in-memory Bun SQLite database.

const ADMIN = { name: "Admin", email: "admin@davloom.test", password: "correct horse battery" };

let db: ReturnType<typeof createBunSqliteDatabase>;
let auth: ReturnType<typeof createAuth>;
let identity: ReturnType<typeof createIdentity>;

beforeEach(() => {
  db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  auth = createAuth({
    database: db,
    secret: "a-test-secret-that-is-at-least-32-characters",
    baseURL: "http://localhost",
  });
  identity = createIdentity(auth);
});

/** Turns a sign-in response into the Cookie header a browser would send back. */
const cookieHeader = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

const signIn = (password: string) =>
  auth.api.signInEmail({ body: { email: ADMIN.email, password }, asResponse: true });

const keyRow = async (id: string) =>
  (await db.select().from(schema.apikey).where(eq(schema.apikey.id, id)))[0];

describe("createAdmin", () => {
  it("creates a verified user who can sign in with the password", async () => {
    const { id } = await identity.createAdmin(ADMIN);

    const [user] = await db.select().from(schema.user);
    expect(user).toMatchObject({ id, name: ADMIN.name, email: ADMIN.email, emailVerified: true });
    expect((await signIn(ADMIN.password)).status).toBe(200);
    expect((await signIn("not the password")).status).toBe(401);
  });
});

describe("sessionUser", () => {
  it("returns the signed-in user of a request carrying the session cookie", async () => {
    const { id } = await identity.createAdmin(ADMIN);
    const response = await signIn(ADMIN.password);

    const user = await identity.sessionUser(new Headers({ cookie: cookieHeader(response) }));

    expect(user).toEqual({ id, name: ADMIN.name, email: ADMIN.email });
  });

  it.each([
    ["no cookie", new Headers()],
    [
      "an unknown session cookie",
      new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
  ])("returns null with %s", async (_case, headers) => {
    await identity.createAdmin(ADMIN);

    expect(await identity.sessionUser(headers)).toBeNull();
  });
});

describe("createApiKey", () => {
  it.each([
    ["read-only", 86_400],
    ["read-write", 30 * 86_400],
  ] as const)("creates a %s key that expires after %i seconds", async (access, expiresIn) => {
    const { id: userId } = await identity.createAdmin(ADMIN);
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
    const { id: userId } = await identity.createAdmin(ADMIN);

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
    const { id: userId } = await identity.createAdmin(ADMIN);
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

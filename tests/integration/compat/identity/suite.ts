import type { Auth } from "@davloom/auth";
import { createAdmin } from "@davloom/auth";
import { beforeAll, describe, expect, it } from "vitest";

/** What the identity suite needs from a database and its Better Auth instance. */
export interface IdentityHarness {
  /** Runs the repository's migrations against an empty database. */
  migrate(): Promise<void>;
  rows(sql: string): Promise<Record<string, unknown>[]>;
  readonly auth: Auth;
}

const ADMIN = {
  name: "Admin",
  email: "admin@davloom.test",
  password: "correct horse battery staple",
};

/** Turns a login response into the Cookie header a browser would send back. */
const cookieHeader = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

export const identitySuite = (name: string, createHarness: () => IdentityHarness) => {
  describe(`identity on ${name}`, () => {
    let harness: IdentityHarness;
    let adminId: string;

    const sessionCount = async () => {
      const [row] = await harness.rows("select count(*) as total from session");
      return Number(row?.total);
    };
    const signIn = (password: string) =>
      harness.auth.api.signInEmail({
        body: { email: ADMIN.email, password },
        asResponse: true,
      });

    beforeAll(async () => {
      harness = createHarness();
      await harness.migrate();
      adminId = (await createAdmin(harness.auth, ADMIN)).id;
    });

    it("the migrations create every identity table", async () => {
      const tables = await harness.rows("select name from sqlite_master where type = 'table'");

      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining(["user", "session", "account", "verification", "apikey"]),
      );
    });

    describe("admin login", () => {
      it("a correct password starts a session", async () => {
        const response = await signIn(ADMIN.password);
        const session = await harness.auth.api.getSession({
          headers: new Headers({ cookie: cookieHeader(response) }),
        });

        expect(response.status).toBe(200);
        expect(session?.user.email).toBe(ADMIN.email);
      });

      it("a wrong password is rejected and starts no session", async () => {
        const before = await sessionCount();
        const response = await signIn("not the password");

        expect(response.status).toBe(401);
        expect(await sessionCount()).toBe(before);
      });

      it("public sign-up is closed", async () => {
        const response = await harness.auth.api.signUpEmail({
          body: {
            name: "Mallory",
            email: "mallory@davloom.test",
            password: "long enough password",
          },
          asResponse: true,
        });

        expect(response.ok).toBe(false);
        expect(
          await harness.rows("select id from user where email = 'mallory@davloom.test'"),
        ).toEqual([]);
      });
    });

    describe("API key lifecycle", () => {
      it("a key works until it is revoked and is never stored in plain text", async () => {
        const { auth } = harness;
        const created = await auth.api.createApiKey({ body: { userId: adminId, name: "client" } });

        const beforeRevoke = await auth.api.verifyApiKey({ body: { key: created.key } });
        const stored = JSON.stringify(await harness.rows("select * from apikey"));
        const login = await signIn(ADMIN.password);
        await auth.api.deleteApiKey({
          body: { keyId: created.id },
          headers: new Headers({ cookie: cookieHeader(login) }),
        });
        const afterRevoke = await auth.api.verifyApiKey({ body: { key: created.key } });

        expect(beforeRevoke.valid).toBe(true);
        expect(stored).toContain(created.id);
        expect(stored).not.toContain(created.key);
        expect(afterRevoke.valid).toBe(false);
      });

      it("rejects a key that never existed", async () => {
        const result = await harness.auth.api.verifyApiKey({ body: { key: "not-a-real-key" } });

        expect(result.valid).toBe(false);
      });
    });
  });
};

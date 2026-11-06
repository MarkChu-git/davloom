import { apiKey } from "@better-auth/api-key";
import * as schema from "@davloom/database/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export interface AuthOptions {
  /** A Drizzle database on the SQLite dialect: D1 in the cloud, Bun SQLite when self-hosted. */
  readonly database: Parameters<typeof drizzleAdapter>[0];
  readonly secret: string;
  readonly baseURL: string;
}

/** The identity configuration shared by every deployment. */
export const createAuth = ({ database, secret, baseURL }: AuthOptions) =>
  betterAuth({
    database: drizzleAdapter(database, { provider: "sqlite", schema }),
    secret,
    baseURL,
    telemetry: { enabled: false },
    // V1 has one administrator, created by createAdmin, so nobody may sign up.
    emailAndPassword: { enabled: true, disableSignUp: true },
    plugins: [
      apiKey({
        // The default allows 10 requests a day per key, and a WebDAV client makes far more.
        rateLimit: { enabled: false },
      }),
    ],
  });

export type Auth = ReturnType<typeof createAuth>;

export interface AdminDetails {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

/** Creates the administrator directly, because public sign-up is closed. */
export const createAdmin = async (auth: Auth, { name, email, password }: AdminDetails) => {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    { name, email, emailVerified: true },
    { method: "admin" },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await context.password.hash(password),
  });
  return user;
};

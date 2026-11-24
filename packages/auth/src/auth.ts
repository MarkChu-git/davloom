import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import * as schema from "@davloom/database/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { haveIBeenPwned, twoFactor, username } from "better-auth/plugins";

export interface AuthOptions {
  /** A Drizzle database on the SQLite dialect: D1 in the cloud, Bun SQLite when self-hosted. */
  readonly database: Parameters<typeof drizzleAdapter>[0];
  readonly secret: string;
  readonly baseURL: string;
  /**
   * Whether new passwords are checked against Have I Been Pwned's leaked passwords (default true).
   * The check fails closed: when the service cannot be reached, the password is refused.
   */
  readonly checkLeakedPasswords?: boolean;
}

/**
 * Whether DAVLOOM_CHECK_LEAKED_PASSWORDS leaves the leaked-password check on: it is on unless the
 * variable says `0`, `false` or `off`, for a deployment that cannot reach the internet.
 */
export const leakedPasswordCheckFrom = (value: string | undefined): boolean =>
  !["0", "false", "off", "no"].includes((value ?? "").trim().toLowerCase());

/** The shortest password Davloom accepts, on registration and on a change. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Better Auth needs an email for every user, and Davloom's owner may have none. Such an owner gets
 * an address in this domain, which RFC 2606 reserves, so it can never receive mail; Davloom never
 * shows it.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "no-email.davloom.invalid";

export const placeholderEmail = (): string => `${crypto.randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`;

/** The owner's own email, or null for the placeholder Better Auth keeps in its place. */
export const publicEmail = (email: string): string | null =>
  email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`) ? null : email;

/** The paths after which a passkey sign-in replaces the browser's earlier session. */
const PASSKEY_SIGN_IN = "/passkey/verify-authentication";

/** The identity configuration shared by every deployment. */
export const createAuth = ({
  database,
  secret,
  baseURL,
  checkLeakedPasswords = true,
}: AuthOptions) => {
  const origin = new URL(baseURL);
  return betterAuth({
    database: drizzleAdapter(database, { provider: "sqlite", schema }),
    secret,
    baseURL,
    telemetry: { enabled: false },
    // The owner registers through Davloom's own /api/registration, which calls the sign-up
    // endpoint on the server once no user exists; the public route stays closed.
    disabledPaths: ["/sign-up/email"],
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    user: {
      // Davloom sends no mail, so an owner's email changes at once (the owner verifies first).
      changeEmail: { enabled: true, updateEmailWithoutVerification: true },
    },
    session: {
      // Davloom asks for a fresh verification itself, for the actions that need one (PRD §6),
      // so Better Auth's own day-long freshness rule would only lock the sessions list.
      freshAge: 0,
      additionalFields: {
        verifiedAt: { type: "date", required: false, input: false },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        // A passkey proves presence by starting a new session. The browser's earlier session, of
        // the same person, ends with it, so a step-up leaves one session behind, not two.
        if (ctx.path !== PASSKEY_SIGN_IN) return;
        const created = ctx.context.newSession;
        if (!created) return;
        const earlier = await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          ctx.context.secret,
        );
        if (!earlier || earlier === created.session.token) return;
        const found = await ctx.context.internalAdapter.findSession(earlier);
        if (found?.session.userId === created.user.id) {
          await ctx.context.internalAdapter.deleteSession(earlier);
        }
      }),
    },
    plugins: [
      username(),
      twoFactor({ issuer: "Davloom" }),
      passkey({ rpID: origin.hostname, rpName: "Davloom", origin: origin.origin }),
      haveIBeenPwned({
        enabled: checkLeakedPasswords,
        customPasswordCompromisedMessage:
          "This password appears in known data breaches. Choose another.",
      }),
      apiKey({
        // The default allows 10 requests a day per key, and a WebDAV client makes far more.
        rateLimit: { enabled: false },
        defaultPrefix: "dav_",
        // Davloom keeps a key's access level, Read Only or Read / Write, in its metadata.
        enableMetadata: true,
        // Davloom shows a key's first characters so the admin can tell keys apart.
        startingCharactersConfig: { shouldStore: true, charactersLength: 10 },
        // The services take names of up to 64 characters; Better Auth's default stops at 32.
        maximumNameLength: 64,
      }),
    ],
  });
};

export type Auth = ReturnType<typeof createAuth>;

export interface AdminDetails {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly username?: string;
}

/**
 * Creates a user directly, without the password checks of registration. Tests and the
 * compatibility probe use it; the Dashboard registers through Identity.registerOwner.
 */
export const createAdmin = async (
  auth: Auth,
  { name, email, password, username: login }: AdminDetails,
) => {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    {
      name,
      email,
      emailVerified: true,
      ...(login === undefined ? {} : { username: login.toLowerCase(), displayUsername: login }),
    },
    { method: "admin" },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    // Better Auth's own hasher: context.password.hash runs the leaked-password check, which needs
    // a request.
    password: await hashPassword(password),
  });
  return user;
};

import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { redactedError } from "@davloom/core";
import type { Database } from "@davloom/database/repositories";
import * as schema from "@davloom/database/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { haveIBeenPwned, twoFactor, username } from "better-auth/plugins";
import { createAttempts } from "./attempts";

export interface AuthOptions {
  /** A Drizzle database on the SQLite dialect: D1 in the cloud, Bun SQLite when self-hosted. */
  readonly database: Database;
  readonly secret: string;
  readonly baseURL: string;
  /**
   * Whether new passwords are checked against Have I Been Pwned's leaked passwords (default true).
   * The check fails closed: when the service cannot be reached, the password is refused.
   */
  readonly checkLeakedPasswords?: boolean;
  /**
   * Whether Better Auth limits how often a client may call its routes (default true), counted in
   * the database so every isolate and process shares the count. Only test harnesses that sign in
   * many times from one address turn it off.
   */
  readonly rateLimit?: boolean;
  /**
   * The headers that name the client's address for the rate limit, which the runtime sets and a
   * client cannot: CF-Connecting-IP on Workers, Davloom's own header on Bun (CLIENT_IP_HEADER).
   */
  readonly clientIpHeaders?: readonly string[];
  /**
   * The instance's public origin from its configuration (DAVLOOM_URL), which passkeys are bound
   * to. Without one, passkeys are off: an origin taken from a request's Host could be any name a
   * client sends.
   */
  readonly passkeyOrigin?: string | undefined;
}

/** The origin a configured URL names, or undefined when it is missing or not http(s). */
export const configuredOrigin = (value: string | undefined): string | undefined => {
  if (value === undefined || !URL.canParse(value.trim())) return undefined;
  const url = new URL(value.trim());
  return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
};

/** The header that Davloom's Bun server sets to the client's address, replacing any it was sent. */
export const CLIENT_IP_HEADER = "x-davloom-client-ip";

/**
 * Whether DAVLOOM_AUTH_RATE_LIMIT leaves Better Auth's rate limit on: it is on unless the variable
 * says `0`, `false`, `off` or `no`.
 */
export const rateLimitFrom = (value: string | undefined): boolean =>
  !["0", "false", "off", "no"].includes((value ?? "").trim().toLowerCase());

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

/**
 * The routes that check an authenticator code. Without a session they are the second step of a
 * sign-in, which Better Auth locks itself; with one they turn two-step verification on, and
 * Davloom counts the failures (attempts.ts).
 */
const SECOND_FACTOR = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

/** The answer to an attempt made while the user is locked out. */
const lockedOut = () =>
  new APIError("TOO_MANY_REQUESTS", {
    message: "Too many wrong attempts. Wait 15 minutes, then try again.",
    code: "VERIFICATION_LOCKED",
  });

/** A short sentence of Better Auth's own, which holds no value a client or the database gave. */
const PLAIN_MESSAGE = /^[A-Za-z][A-Za-z .,'()-]{0,119}$/;

/** The cause an APIError wraps, or the error itself. */
const errorBehind = (error: unknown): unknown =>
  isAPIError(error) && error.cause !== undefined ? error.cause : error;

/** Better Auth's log, with every error named by its class and code alone (packages/core redact). */
export const logRedacted = (
  level: "info" | "warn" | "error" | "debug",
  message: string,
  ...args: unknown[]
) => {
  const text = PLAIN_MESSAGE.test(message) ? message : "(message withheld)";
  const details = args.map((arg) => redactedError(errorBehind(arg)));
  const write = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  write(`[Better Auth] ${level}: ${text}`, ...details);
};

/** The identity configuration shared by every deployment. */
export const createAuth = ({
  database,
  secret,
  baseURL,
  checkLeakedPasswords = true,
  rateLimit = true,
  clientIpHeaders = [],
  passkeyOrigin,
}: AuthOptions) => {
  const passkeyUrl = passkeyOrigin === undefined ? undefined : new URL(passkeyOrigin);
  const attempts = createAttempts(database);
  const auth = betterAuth({
    database: drizzleAdapter(database, { provider: "sqlite", schema }),
    secret,
    baseURL,
    // Without DAVLOOM_URL the base URL is the first request's origin, which any client could have
    // named. Davloom's app lets only same-origin requests reach these routes (apps/api
    // same-origin.ts), so Better Auth takes the origin each request was sent to as its own, and a
    // first request with a forged Host cannot lock the real origin out.
    trustedOrigins: (request) => {
      if (request === undefined || !URL.canParse(request.url)) return [];
      const url = new URL(request.url);
      const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
      return forwarded?.toLowerCase() === "https"
        ? [url.origin, `https://${url.host}`]
        : [url.origin];
    },
    telemetry: { enabled: false },
    // Better Auth and its router log an error they did not raise themselves as it is, and a
    // database's error can name the values its query was bound to: session tokens, password
    // hashes. Its own log keeps only the class and code of an error, and a message only when it
    // is one of Better Auth's short sentences; any other error leaves the router unlogged, and
    // `handler` below logs it the same way.
    logger: { log: logRedacted },
    onAPIError: { throw: true },
    // On in every environment, not only with NODE_ENV=production, and in the database, which
    // every Worker isolate and Bun process shares. Better Auth's own rules apply on top of these,
    // such as 3 sign-ins per 10 seconds.
    rateLimit: {
      enabled: rateLimit,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/*": { window: 60, max: 10 },
        "/two-factor/*": { window: 60, max: 10 },
        "/passkey/*": { window: 60, max: 30 },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: [...clientIpHeaders] } },
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
      before: createAuthMiddleware(async (ctx) => {
        // A code that a signed-in session sends over HTTP counts towards the user's lock. Davloom's
        // own step-up verification calls the route on the server, without a request, and counts
        // its attempts itself (identity.ts).
        if (!SECOND_FACTOR.has(ctx.path) || !ctx.request) return;
        const found = await getSessionFromCtx(ctx);
        if (!found) return;
        if (!(await attempts.take(found.user.id))) throw lockedOut();
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (
          SECOND_FACTOR.has(ctx.path) &&
          ctx.request &&
          !(ctx.context.returned instanceof Error)
        ) {
          const found = ctx.context.newSession ?? (await getSessionFromCtx(ctx));
          if (found) await attempts.clear(found.user.id);
          return;
        }
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
      ...(passkeyUrl === undefined
        ? []
        : [passkey({ rpID: passkeyUrl.hostname, rpName: "Davloom", origin: passkeyUrl.origin })]),
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
  // Davloom's own count of failed proofs of presence, which identity.ts shares.
  const betterAuthHandler = auth.handler;
  const handler = async (request: Request): Promise<Response> => {
    try {
      return await betterAuthHandler(request);
    } catch (error) {
      console.error("[Better Auth] request failed:", redactedError(errorBehind(error)));
      return Response.json({ error: { code: "internal_error" } }, { status: 500 });
    }
  };
  return Object.assign(auth, { attempts, handler });
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

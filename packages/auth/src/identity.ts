import { isAPIError } from "better-auth/api";
import { publicEmail, placeholderEmail, type Auth } from "./auth";

// The Identity Port of @davloom/core, implemented with Better Auth.

export interface KeyMetadata {
  readonly access: "read-only" | "read-write";
  readonly paths?: readonly string[];
}

/** Why Better Auth refused a registration, by the field it names, or that it could not check. */
export type Registration =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly refusal: "closed" }
  | {
      readonly ok: false;
      readonly refusal: "field";
      readonly field: "username" | "password" | "email";
      readonly reason: string;
    }
  | { readonly ok: false; readonly refusal: "check-failed"; readonly reason: string };

export type Reverification =
  | "verified"
  | "no-session"
  | "wrong-password"
  | "code-required"
  | "wrong-code";

const FIELD_OF_CODE: Readonly<Record<string, "username" | "password" | "email">> = {
  PASSWORD_TOO_SHORT: "password",
  PASSWORD_TOO_LONG: "password",
  PASSWORD_COMPROMISED: "password",
  USERNAME_IS_ALREADY_TAKEN: "username",
  USERNAME_TOO_SHORT: "username",
  USERNAME_TOO_LONG: "username",
  INVALID_USERNAME: "username",
  INVALID_DISPLAY_USERNAME: "username",
  INVALID_EMAIL: "email",
  USER_ALREADY_EXISTS: "email",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "email",
};

const codeOf = (error: unknown): string | undefined => {
  if (!isAPIError(error)) return undefined;
  const body: unknown = error.body;
  return typeof body === "object" &&
    body !== null &&
    "code" in body &&
    typeof body.code === "string"
    ? body.code
    : undefined;
};

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message !== "" ? error.message : "The request was refused.";

const time = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" || typeof value === "string") return new Date(value).getTime();
  return Number.NaN;
};

export const createIdentity = (auth: Auth) => {
  const countUsers = async () => {
    const context = await auth.$context;
    return await context.adapter.count({ model: "user" });
  };

  return {
    /**
     * Creates the owner through Better Auth's sign-up, with its username, password length and
     * leaked-password checks. Only the first registration can win: the database refuses a second
     * user in the same statement that would insert it (migration 0004).
     */
    registerOwner: async (details: {
      username: string;
      name: string;
      email: string | null;
      password: string;
    }): Promise<Registration> => {
      if ((await countUsers()) > 0) return { ok: false, refusal: "closed" };
      try {
        const created = await auth.api.signUpEmail({
          body: {
            name: details.name,
            email: details.email ?? placeholderEmail(),
            password: details.password,
            username: details.username,
          },
        });
        return { ok: true, id: created.user.id };
      } catch (error) {
        const code = codeOf(error);
        // Better Auth's body validation names the field, as in "[body.email] Invalid email".
        const validated = /^\[body\.(username|password|email)\]/.exec(messageOf(error))?.[1];
        const field =
          validated === "username" || validated === "password" || validated === "email"
            ? validated
            : code === undefined
              ? undefined
              : FIELD_OF_CODE[code];
        if (field !== undefined) {
          return { ok: false, refusal: "field", field, reason: messageOf(error) };
        }
        if ((await countUsers()) > 0) return { ok: false, refusal: "closed" };
        // The leaked-password check could not reach its service, and refuses rather than guess.
        if (isAPIError(error) && error.statusCode >= 500) {
          return { ok: false, refusal: "check-failed", reason: messageOf(error) };
        }
        throw error;
      }
    },

    sessionUser: async (headers: Headers) => {
      const found = await auth.api.getSession({ headers });
      if (!found) return null;
      const { user, session } = found;
      const verifiedAt = Math.max(time(session.createdAt), time(session.verifiedAt ?? null) || 0);
      return {
        id: user.id,
        name: user.name,
        username: user.displayUsername ?? user.username ?? null,
        email: publicEmail(user.email),
        twoFactorEnabled: user.twoFactorEnabled === true,
        verifiedAt,
      };
    },

    /**
     * Proves presence again for a step-up action: the password, and the authenticator's code when
     * two-step verification is on. On success the session's verifiedAt moves to now.
     */
    reverify: async (
      headers: Headers,
      input: { password: string; code: string },
    ): Promise<Reverification> => {
      const found = await auth.api.getSession({ headers });
      if (!found) return "no-session";
      try {
        await auth.api.verifyPassword({ body: { password: input.password }, headers });
      } catch (error) {
        if (isAPIError(error) && error.statusCode < 500) return "wrong-password";
        throw error;
      }
      if (found.user.twoFactorEnabled === true) {
        if (input.code.trim() === "") return "code-required";
        try {
          // With a session, Better Auth only checks the code, counting failures towards its lock.
          await auth.api.verifyTOTP({ body: { code: input.code.trim() }, headers });
        } catch (error) {
          if (isAPIError(error) && error.statusCode < 500) return "wrong-code";
          throw error;
        }
      }
      const context = await auth.$context;
      await context.internalAdapter.updateSession(found.session.token, { verifiedAt: new Date() });
      return "verified";
    },

    createApiKey: async (details: {
      userId: string;
      name: string;
      expiresIn: number | null;
      metadata: KeyMetadata;
    }) => {
      const created = await auth.api.createApiKey({
        body: {
          userId: details.userId,
          name: details.name,
          metadata: { ...details.metadata },
          ...(details.expiresIn === null ? {} : { expiresIn: details.expiresIn }),
        },
      });
      return { id: created.id, key: created.key };
    },
  };
};

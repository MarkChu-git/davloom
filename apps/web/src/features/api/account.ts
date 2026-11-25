import { passkeyClient } from "@better-auth/passkey/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/client";
import { generateRandomString } from "better-auth/crypto";
import { ApiError, apiFetch, apiFetchOnce } from "./client";
import { withStepUp } from "./stepUp";

// The owner's account: registration, sign-in with a password, a second step or a passkey, and
// the settings of Sign-in and security. Better Auth answers under /api/auth (packages/auth);
// Davloom's own routes handle registration and step-up verification.

/** How long a generated password is: 24 characters of 64 make 144 random bits. */
export const GENERATED_PASSWORD_LENGTH = 24;

/** A random password from Better Auth's generator, over letters, digits, `-` and `_`. */
export const generatePassword = (): string => generateRandomString(GENERATED_PASSWORD_LENGTH);

/** The shortest password the server accepts (packages/auth MIN_PASSWORD_LENGTH). */
export const MIN_PASSWORD = 12;

/** Better Auth's client, only for the WebAuthn ceremonies of passkeys. */
const authClient = () =>
  createAuthClient({
    baseURL: location.origin,
    plugins: [passkeyClient()],
  });

type ClientError = { status: number; code?: string | undefined; message?: string | undefined };

/** Turns the client's `{ error }` into the ApiError every other call throws. */
const throwIfError = (error: ClientError | null | undefined): void => {
  if (error) {
    throw new ApiError(
      error.status,
      error.code === undefined ? `http_${error.status}` : error.code.toLowerCase(),
      error.message,
    );
  }
};

// --- Registration --------------------------------------------------------------------------

export interface RegistrationStatus {
  /** The instance has no owner yet, so its first visitor may register. */
  open: boolean;
  /** Registering, or importing in its place, needs the deployment's setup token. */
  tokenRequired?: boolean;
  /** Passkeys are on, which needs the instance's configured public URL (DAVLOOM_URL). */
  passkeys?: boolean;
}

export const registrationQuery = {
  queryKey: ["registration"] as const,
  queryFn: () => apiFetch<RegistrationStatus>("/api/registration"),
  retry: false,
} as const;

export const register = (input: {
  username: string;
  name: string;
  email: string;
  password: string;
  setupToken?: string;
}) => apiFetch<{ userId: string }>("/api/registration", { method: "POST", body: input });

/** Imports an export into this instance in place of registering its owner. */
export const importInstance = (input: { key: string; file: unknown; setupToken?: string }) =>
  apiFetch<Record<string, number>>("/api/registration/import", { method: "POST", body: input });

// --- Signing in ----------------------------------------------------------------------------

/** What a password sign-in leads to: the Dashboard, or the second step. */
export type SignInStep = "signed-in" | "second-step";

/**
 * Signs in with a username, or with the email when the identifier holds an `@`, which no
 * username does.
 */
export const signInWithPassword = async (
  identifier: string,
  password: string,
): Promise<SignInStep> => {
  const answer = identifier.includes("@")
    ? await apiFetchOnce<unknown>("/api/auth/sign-in/email", {
        method: "POST",
        body: { email: identifier, password },
      })
    : await apiFetchOnce<unknown>("/api/auth/sign-in/username", {
        method: "POST",
        body: { username: identifier, password },
      });
  return typeof answer === "object" &&
    answer !== null &&
    Reflect.get(answer, "twoFactorRedirect") === true
    ? "second-step"
    : "signed-in";
};

/** The second step of a sign-in, or of turning two-step verification on: the app's code. */
export const verifyTotp = (code: string) =>
  apiFetchOnce<unknown>("/api/auth/two-factor/verify-totp", {
    method: "POST",
    body: { code: code.replace(/\s/g, "") },
  });

export const verifyBackupCode = (code: string) =>
  apiFetchOnce<unknown>("/api/auth/two-factor/verify-backup-code", {
    method: "POST",
    body: { code: code.trim() },
  });

/** Signs in with a passkey; after a step-up it replaces this browser's session (packages/auth). */
export const signInWithPasskey = async (): Promise<void> => {
  const { error } = await authClient().signIn.passkey();
  throwIfError(error);
};

/** Whether this browser can use passkeys at all. */
export const canUsePasskeys = (): boolean =>
  typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";

export const signOut = () =>
  apiFetchOnce<unknown>("/api/auth/sign-out", { method: "POST", body: {} });

/** Proves presence again for a step-up action: the password, and the code when two-step is on. */
export const reverify = (password: string, code: string) =>
  apiFetchOnce<{ verified: true }>("/api/verify", {
    method: "POST",
    body: { password, code: code.replace(/\s/g, "") },
  });

// --- Profile -------------------------------------------------------------------------------

export const accountKeys = {
  session: ["account", "session"] as const,
  sessions: ["account", "sessions"] as const,
  passkeys: ["account", "passkeys"] as const,
};

/** Changes the display name, and the username when it differs (a step-up action). */
export const updateProfile = (input: { name: string; username?: string }) =>
  apiFetch<unknown>("/api/auth/update-user", { method: "POST", body: input });

export const changeEmail = (newEmail: string) =>
  apiFetch<unknown>("/api/auth/change-email", { method: "POST", body: { newEmail } });

export const changePassword = (input: { currentPassword: string; newPassword: string }) =>
  apiFetch<unknown>("/api/auth/change-password", {
    method: "POST",
    body: { ...input, revokeOtherSessions: false },
  });

// --- Two-step verification -----------------------------------------------------------------

/** Starts turning two-step verification on: the authenticator's URI and the backup codes. */
export const enableTwoFactor = (password: string) =>
  apiFetch<{ totpURI: string; backupCodes: string[] }>("/api/auth/two-factor/enable", {
    method: "POST",
    body: { password },
  });

export const disableTwoFactor = (password: string) =>
  apiFetch<unknown>("/api/auth/two-factor/disable", { method: "POST", body: { password } });

export const newBackupCodes = (password: string) =>
  apiFetch<{ backupCodes: string[] }>("/api/auth/two-factor/generate-backup-codes", {
    method: "POST",
    body: { password },
  });

/** The secret an authenticator app takes by hand, from an otpauth:// URI. */
export const setupKeyOf = (uri: string): string => {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
};

// --- Passkeys and sessions -----------------------------------------------------------------

export interface Passkey {
  id: string;
  name: string | null;
  createdAt: string | null;
  deviceType: string;
  backedUp: boolean;
}

export interface SignedInSession {
  id: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export const usePasskeys = () =>
  useQuery({
    queryKey: accountKeys.passkeys,
    queryFn: () => apiFetch<Passkey[]>("/api/auth/passkey/list-user-passkeys"),
  });

/** Adds a passkey of this device; registering one is a step-up action. */
export const addPasskey = (name: string) =>
  withStepUp(async () => {
    const { error } = await authClient().passkey.addPasskey({ name });
    throwIfError(error);
  });

export const removePasskey = (id: string) =>
  apiFetch<unknown>("/api/auth/passkey/delete-passkey", { method: "POST", body: { id } });

/** Every session of the owner, and the token of this browser's. */
export const useSessions = () =>
  useQuery({
    queryKey: accountKeys.sessions,
    queryFn: async () => {
      const [sessions, current] = await Promise.all([
        apiFetch<SignedInSession[]>("/api/auth/list-sessions"),
        apiFetch<{ session: { token: string } } | null>("/api/auth/get-session"),
      ]);
      return { sessions, currentToken: current?.session.token ?? null };
    },
  });

export const revokeSession = (token: string) =>
  apiFetch<unknown>("/api/auth/revoke-session", { method: "POST", body: { token } });

/** A mutation that reads the account's lists and the owner again once it is done. */
export const useAccountMutation = <I, O>(run: (input: I) => Promise<O>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["account"] }),
        client.invalidateQueries({ queryKey: ["me"] }),
      ]),
  });
};

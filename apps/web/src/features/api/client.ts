import { createApiClient, jsonRequest, type Fetcher, type Outcome } from "@davloom/client";
import type { MessageKey } from "../i18n/messages/en";
import type { Translator } from "../i18n/translate";
import { DavError } from "./dav";
import { VERIFICATION_REQUIRED, withStepUp } from "./stepUp";
// The Dashboard's calls to the management API (apps/api/src/app.ts): Davloom's own routes through
// the typed client of packages/client, Better Auth's through `authFetch`. Every call goes to the
// origin that served the Dashboard and carries its session cookie.

/** A refused call: the HTTP status and the API's machine-readable code, when it sent one. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The API's own explanation, such as why an import was refused, when it sent one. */
  readonly detail: string | undefined;
  /** Why a field was refused, machine-readable, such as `too_short`, when the API sent it. */
  readonly reason: string | undefined;

  constructor(status: number, code: string, detail?: string, reason?: string) {
    super(`${status} ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.reason = reason;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

/** Whether an error says the browser has no session, or its session ended. */
/** A 401 from the API or from WebDAV: either means the session ended. */
export const isUnauthorized = (error: unknown): boolean =>
  (isApiError(error) || error instanceof DavError) && error.status === 401;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The code in an error body such as `{"error":{"code":"name_taken"}}`, or a code for the status. */
export const errorCodeOf = (status: number, body: unknown): string => {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.code === "string") {
    return body.error.code;
  }
  if (isRecord(body) && typeof body.code === "string") {
    // Better Auth answers with `{ code, message }`, its codes in capitals.
    return body.code.toLowerCase();
  }
  return status === 401 ? "unauthorized" : `http_${status}`;
};

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

/**
 * The message in an error body such as `{"error":{"code":"archive_invalid","message":"…"}}`, or
 * Better Auth's own `{ code, message }`.
 */
const detailOf = (body: unknown): string | undefined => {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
    return body.error.message;
  }
  return isRecord(body) && typeof body.message === "string" && body.message !== ""
    ? body.message
    : undefined;
};

/** The `reason` in an error body such as `{"error":{"code":"password_refused","reason":"too_short"}}`. */
const reasonOf = (body: unknown): string | undefined =>
  isRecord(body) && isRecord(body.error) && typeof body.error.reason === "string"
    ? body.error.reason
    : undefined;

/**
 * Sends one request to the API with the session cookie, as JSON when it changes something
 * (`jsonRequest`); a dropped connection throws an ApiError with status 0. Both clients below send
 * through it.
 */
export const send: Fetcher = async (url, init) => {
  const { method, headers, body } = jsonRequest(init);
  try {
    return await fetch(url, { method, credentials: "same-origin", headers, body });
  } catch {
    throw new ApiError(0, "network_error");
  }
};

/** The typed client of Davloom's own routes (packages/client), on this page's origin. */
export const api = createApiClient({ fetcher: send });

/**
 * Runs a call of the typed client and returns its answer, or throws an ApiError. An action that
 * needs step-up verification asks for it and runs again (stepUp.ts).
 */
export const apiCall = <Data>(call: () => Promise<Outcome<Data>>): Promise<Data> =>
  withStepUp(() => apiCallOnce(call));

/** Runs a call of the typed client once, without asking for verification. */
export const apiCallOnce = async <Data>(call: () => Promise<Outcome<Data>>): Promise<Data> => {
  let outcome: Outcome<Data>;
  try {
    outcome = await call();
  } catch {
    // Eden throws when an answer that says it is JSON is not.
    throw new ApiError(0, "network_error");
  }
  if (outcome.error === null) return outcome.data;
  const { status, error } = outcome;
  // The fetcher threw: `send` throws an ApiError for a dropped connection.
  if (outcome.response === undefined) {
    throw isApiError(error.value) ? error.value : new ApiError(0, "network_error");
  }
  throw new ApiError(
    status,
    errorCodeOf(status, error.value),
    detailOf(error.value),
    reasonOf(error.value),
  );
};

/**
 * Calls one of Better Auth's routes under /api/auth, which the typed client does not cover, and
 * returns its JSON answer, or throws an ApiError. An action that needs step-up verification asks
 * for it and runs again (stepUp.ts).
 */
export const authFetch = <T>(path: string, body?: unknown): Promise<T> =>
  withStepUp(() => authFetchOnce<T>(path, body));

/** Calls one of Better Auth's routes once: a GET without a body, otherwise a POST of `body`. */
export const authFetchOnce = async <T>(path: string, body?: unknown): Promise<T> => {
  const response = await send(path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed = await readBody(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      errorCodeOf(response.status, parsed),
      detailOf(parsed),
      reasonOf(parsed),
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Better Auth's own answer for this path
  return parsed as T;
};

/** What a refused call means for the person, in a sentence. */
/**
 * The API's own explanation, in English, where Davloom shows English; another language says what
 * the code means in its own words instead.
 */
const detailIn = (t: Translator, error: ApiError): string | undefined =>
  t.locale === "en" ? error.detail : undefined;

/**
 * The words for each reason a field can be refused for, by the API's code and its `reason`
 * (docs/api.md). A reason not listed, such as `invalid`, gets the field's general message.
 */
const REFUSALS: Readonly<Record<string, Readonly<Record<string, MessageKey>>>> = {
  username_refused: {
    too_short: "error.usernameTooShort",
    too_long: "error.usernameTooLong",
    invalid_characters: "error.usernameInvalidCharacters",
    taken: "error.usernameTaken",
  },
  password_refused: {
    too_short: "error.passwordTooShort",
    too_long: "error.passwordTooLong",
    compromised: "error.passwordCompromised",
  },
  email_refused: { invalid: "error.emailInvalid", taken: "error.emailTaken" },
};

/** Better Auth's own codes for the same refusals, as it answers changing a password or email. */
const AUTH_REFUSALS: Readonly<Record<string, MessageKey>> = {
  password_too_short: "error.passwordTooShort",
  password_too_long: "error.passwordTooLong",
  username_too_short: "error.usernameTooShort",
  username_too_long: "error.usernameTooLong",
  invalid_username: "error.usernameInvalidCharacters",
  username_is_already_taken: "error.usernameTaken",
  invalid_email: "error.emailInvalid",
  user_already_exists: "error.emailTaken",
  user_already_exists_use_another_email: "error.emailTaken",
};

/** The Dashboard's own words for why a field was refused, in the language shown; else none. */
const refusalIn = (t: Translator, error: ApiError): string | undefined => {
  const reasons = Object.hasOwn(REFUSALS, error.code) ? REFUSALS[error.code] : undefined;
  const key =
    reasons !== undefined && error.reason !== undefined && Object.hasOwn(reasons, error.reason)
      ? reasons[error.reason]
      : undefined;
  return key === undefined ? undefined : t(key);
};

export const describeError = (t: Translator, error: unknown): string => {
  if (!isApiError(error)) {
    return t("error.unknown");
  }
  switch (error.code) {
    case "network_error":
      return t("error.network");
    case "unauthorized":
      return t("error.unauthorized");
    case "not_configured":
      return t("error.notConfigured");
    case "mount_in_use":
      return t("error.mountInUse");
    case "name_taken":
      return t("error.nameTaken");
    case "not_found":
      return t("error.notFound");
    case "invalid_input":
      return t("error.invalidInput");
    case "backend_in_use":
      return t("error.backendInUse");
    case "backend_not_empty":
      return t("error.backendNotEmpty");
    case "backend_unavailable":
      return t("error.backendUnavailable");
    case "setup_token_invalid":
      return t("error.setupTokenInvalid");
    case "cross_site":
      return detailIn(t, error) ?? t("error.crossSite");
    case "unsupported_media_type":
      return t("error.unsupportedMediaType");
    case "archive_invalid":
      return detailIn(t, error) ?? t("error.archiveInvalid");
    case VERIFICATION_REQUIRED:
      return t("error.verificationRequired");
    case "registration_closed":
      return t("error.registrationClosed");
    case "username_refused":
      return refusalIn(t, error) ?? detailIn(t, error) ?? t("error.usernameRefused");
    case "password_refused":
      return refusalIn(t, error) ?? detailIn(t, error) ?? t("error.passwordRefused");
    case "email_refused":
      return refusalIn(t, error) ?? detailIn(t, error) ?? t("error.emailRefused");
    case "verification_locked":
      return t("error.verificationLocked");
    case "password_check_failed":
      return t("error.passwordCheckFailed");
    case "password_compromised":
      return detailIn(t, error) ?? t("error.passwordCompromised");
    default: {
      if (Object.hasOwn(AUTH_REFUSALS, error.code)) {
        const key = AUTH_REFUSALS[error.code];
        if (key !== undefined) return t(key);
      }
      // Better Auth explains its other refusals in English.
      const detail = detailIn(t, error);
      if (detail !== undefined && error.status >= 400 && error.status < 500) {
        return detail;
      }
      return error.status === 501
        ? t("error.notImplemented")
        : t("error.refused", { status: String(error.status) });
    }
  }
};

import type { Translator } from "../i18n/translate";
import { DavError } from "./dav";
import { VERIFICATION_REQUIRED, withStepUp } from "./stepUp";
// The Dashboard's calls to the management API (apps/api/src/app.ts). Every call goes to the origin
// that served the Dashboard and carries its session cookie.

/** A refused call: the HTTP status and the API's machine-readable code, when it sent one. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The API's own explanation, such as why an import was refused, when it sent one. */
  readonly detail: string | undefined;

  constructor(status: number, code: string, detail?: string) {
    super(`${status} ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
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

/**
 * Calls the API and returns its JSON answer, or throws an ApiError. An action that needs step-up
 * verification asks for it and runs again (stepUp.ts).
 */
export const apiFetch = <T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> => withStepUp(() => apiFetchOnce<T>(path, options));

/** Calls the API once, without asking for verification. */
export const apiFetchOnce = async <T>(
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {},
): Promise<T> => {
  let response: Response;
  // The API takes a request that changes something only as JSON from this origin, which no
  // cross-site form can send (apps/api same-origin.ts), so every such request carries JSON.
  const changes = method !== "GET" && method !== "HEAD";
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: changes || body !== undefined ? { "content-type": "application/json" } : {},
      body: body === undefined ? (changes ? "{}" : undefined) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error");
  }
  const parsed = await readBody(response);
  if (!response.ok) {
    throw new ApiError(response.status, errorCodeOf(response.status, parsed), detailOf(parsed));
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the API's own answer for this path
  return parsed as T;
};

/** What a refused call means for the person, in a sentence. */
/**
 * The API's own explanation, in English, where Davloom shows English; another language says what
 * the code means in its own words instead.
 */
const detailIn = (t: Translator, error: ApiError): string | undefined =>
  t.locale === "en" ? error.detail : undefined;

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
      return detailIn(t, error) ?? t("error.usernameRefused");
    case "password_refused":
      return detailIn(t, error) ?? t("error.passwordRefused");
    case "email_refused":
      return detailIn(t, error) ?? t("error.emailRefused");
    case "verification_locked":
      return t("error.verificationLocked");
    case "password_check_failed":
      return t("error.passwordCheckFailed");
    case "password_compromised":
      return detailIn(t, error) ?? t("error.passwordCompromised");
    default: {
      // Better Auth explains its refusals, such as a username that is taken.
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

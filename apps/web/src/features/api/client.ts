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
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
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
export const describeError = (error: unknown): string => {
  if (!isApiError(error)) {
    return "Something went wrong. Try again.";
  }
  switch (error.code) {
    case "network_error":
      return "Davloom could not be reached. Check the connection and try again.";
    case "unauthorized":
      return "Your session has ended. Sign in again.";
    case "not_configured":
      return "This instance is not configured: DAVLOOM_SECRET is missing or shorter than 32 bytes.";
    case "mount_in_use":
      return "An API key is limited to this mount. Revoke that key first.";
    case "name_taken":
      return "That name is already in use.";
    case "not_found":
      return "It is no longer there.";
    case "invalid_input":
      return "Check the values and try again.";
    case "backend_in_use":
      return "A mount uses this backend. Move or remove the mount first.";
    case "backend_not_empty":
      return "This backend still holds files. Delete them first.";
    case "backend_unavailable":
      return "The backend did not answer. Try again.";
    case "archive_invalid":
      return error.detail ?? "This export cannot be imported.";
    case VERIFICATION_REQUIRED:
      return "Verify it is you to do this.";
    case "registration_closed":
      return "This Davloom has its owner already. Sign in instead.";
    case "username_refused":
    case "password_refused":
    case "email_refused":
      return error.detail ?? "Check the values and try again.";
    case "password_check_failed":
      return "Davloom could not check the password against known breaches. Try again later.";
    case "password_compromised":
      return error.detail ?? "This password appears in known data breaches. Choose another.";
    default:
      // Better Auth explains its refusals, such as a username that is taken.
      if (error.detail !== undefined && error.status >= 400 && error.status < 500) {
        return error.detail;
      }
      return error.status === 501
        ? "This server does not run the management API yet."
        : `The server refused the request (${error.status}).`;
  }
};

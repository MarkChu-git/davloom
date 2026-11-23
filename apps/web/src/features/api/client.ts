import { DavError } from "./dav";
// The Dashboard's calls to the management API (apps/api/src/app.ts). Every call goes to the origin
// that served the Dashboard and carries its session cookie.

/** A refused call: the HTTP status and the API's machine-readable code, when it sent one. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
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

/** Calls the API and returns its JSON answer, or throws an ApiError. */
export const apiFetch = async <T>(
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
    throw new ApiError(response.status, errorCodeOf(response.status, parsed));
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
    case "name_taken":
      return "That name is already in use.";
    case "not_found":
      return "It is no longer there.";
    case "invalid_input":
      return "Check the values and try again.";
    default:
      return error.status === 501
        ? "This server does not run the management API yet."
        : `The server refused the request (${error.status}).`;
  }
};

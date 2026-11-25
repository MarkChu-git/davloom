// Step-up verification on the Dashboard's side (PRD §6). The server refuses a sensitive action
// from a session that has not proved presence lately with 403 `verification_required`
// (apps/api/src/verification.ts). Every request of the Dashboard goes through `withStepUp`, through
// `apiCall`, `authFetch` and the WebDAV client, so on that answer the step-up dialog
// (auth/StepUpDialog.tsx) asks for the password, the authenticator code or a passkey, and the
// request then runs once more.
// A page needs nothing of its own: a mutation that hits a step-up action just takes longer.

/** The code the server answers a step-up action with when the session needs to verify again. */
export const VERIFICATION_REQUIRED = "verification_required";

/** Asks the person to verify; resolves true once they did, false when they cancelled. */
export type StepUpHandler = () => Promise<boolean>;

let handler: StepUpHandler | undefined;
let pending: Promise<boolean> | undefined;

/** Installs the dialog that verifies; returns a function that removes it again. */
export const setStepUpHandler = (next: StepUpHandler): (() => void) => {
  handler = next;
  return () => {
    if (handler === next) {
      handler = undefined;
    }
  };
};

/**
 * Asks for a verification. Requests refused at the same time share one dialog. Without a dialog,
 * as outside the Dashboard, the answer is false.
 */
export const requestStepUp = (): Promise<boolean> => {
  if (handler === undefined) {
    return Promise.resolve(false);
  }
  pending ??= handler().finally(() => {
    pending = undefined;
  });
  return pending;
};

/** Whether an error is the server's request to verify again. */
export const needsStepUp = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 403 &&
  "code" in error &&
  error.code === VERIFICATION_REQUIRED;

/**
 * Runs a request; when the server asks for verification, asks the person and runs it once more.
 * Without a verification, the refusal stands.
 */
export const withStepUp = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (!needsStepUp(error) || !(await requestStepUp())) {
      throw error;
    }
    return await run();
  }
};

// The checks of the sign-in and setup forms, apart from the pages so that tests load no styles.

/**
 * Where to go once signed in: a path of the Dashboard, never another site. `//host` and `/\host`
 * would leave the origin, so only a single leading slash counts.
 */
export const safeRedirect = (target: string | undefined): string =>
  target !== undefined && /^\/(?![/\\])/.test(target) ? target : "/";

/** The shortest password the server accepts for the administrator. */
export const MIN_PASSWORD = 12;

const EMAIL = /^[^\s@]+@[^\s@]+$/;

export interface SetupFields {
  name: string;
  email: string;
  password: string;
  token: string;
}

/** Why each field cannot be sent, as the server would answer; an empty object when all can. */
export const setupProblems = (fields: SetupFields): Partial<Record<keyof SetupFields, string>> => {
  const problems: Partial<Record<keyof SetupFields, string>> = {};
  if (fields.name.trim() === "") {
    problems.name = "Enter the name Davloom should call you.";
  }
  if (!EMAIL.test(fields.email.trim())) {
    problems.email = "Enter an email address, such as you@example.com.";
  }
  if (fields.password.length < MIN_PASSWORD) {
    problems.password = `Use at least ${MIN_PASSWORD} characters.`;
  } else if (fields.password.length > 128) {
    problems.password = "Use at most 128 characters.";
  }
  if (fields.token.trim() === "") {
    problems.token = "Enter the setup token of this deployment.";
  }
  return problems;
};

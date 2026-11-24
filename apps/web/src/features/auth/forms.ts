// The checks of the sign-in and registration forms, apart from the pages so that tests load no
// styles. The server checks again, and its reasons, such as a leaked password, show as they are.

/**
 * Where to go once signed in: a path of the Dashboard, never another site. `//host` and `/\host`
 * would leave the origin, so only a single leading slash counts.
 */
export const safeRedirect = (target: string | undefined): string =>
  target !== undefined && /^\/(?![/\\])/.test(target) ? target : "/";

/** The shortest password the server accepts. */
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** Better Auth's usernames: 3 to 30 letters, digits, `_` and `.`. */
const USERNAME = /^[a-zA-Z0-9_.]{3,30}$/;

export interface RegistrationFields {
  username: string;
  name: string;
  email: string;
  password: string;
}

/** Why each field cannot be sent; an empty object when all can. */
export const registrationProblems = (
  fields: RegistrationFields,
): Partial<Record<keyof RegistrationFields, string>> => {
  const problems: Partial<Record<keyof RegistrationFields, string>> = {};
  const username = fields.username.trim();
  if (username === "") {
    problems.username = "Enter a username.";
  } else if (!USERNAME.test(username)) {
    problems.username = "Use 3 to 30 letters, digits, dots or underscores.";
  }
  if (fields.name.trim().length > 100) {
    problems.name = "Use at most 100 characters.";
  }
  if (fields.email.trim() !== "" && !EMAIL.test(fields.email.trim())) {
    problems.email = "Enter an email address, such as you@example.com.";
  }
  const password = passwordProblem(fields.password);
  if (password !== undefined) {
    problems.password = password;
  }
  return problems;
};

/** Why a new password cannot be sent, or undefined. */
export const passwordProblem = (password: string): string | undefined => {
  if (password.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters.`;
  }
  if (password.length > MAX_PASSWORD) {
    return `Use at most ${MAX_PASSWORD} characters.`;
  }
  return undefined;
};

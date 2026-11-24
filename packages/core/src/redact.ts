// What a log may say about an error from a database or another dependency. Their messages can hold
// the values a query was bound to, such as Drizzle's "params:" line with password and API Key
// hashes or sealed secrets, so a log names only each error's class and code, and where it was
// thrown, never its message.

const NAME = /^[A-Za-z_$][\w$]*$/;
const CODE = /^[A-Z][A-Z0-9_]*$/;

const describe = (error: unknown): string => {
  if (!(error instanceof Error)) return typeof error;
  const name = NAME.test(error.name) ? error.name : "Error";
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" && CODE.test(code) ? `${name} (${code})` : name;
};

/** The classes and codes of an error and of its causes, as `DrizzleQueryError <- SqliteError`. */
export const redactedError = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && (depth === 0 || current != null); depth += 1) {
    parts.push(describe(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(" <- ");
};

/** The stack frames of an error without its first line, which repeats the message. */
export const redactedStack = (error: unknown): string =>
  error instanceof Error && typeof error.stack === "string"
    ? error.stack
        .split("\n")
        .filter((line) => /^\s+at /.test(line))
        .join("\n")
    : "";

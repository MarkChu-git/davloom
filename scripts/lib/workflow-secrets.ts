// The secrets that a GitHub Actions file reads (add-ci-baseline, task 5.2). Pull request checks
// read no repository secret, so a pull request from a fork gets the same results as a branch.
// GITHUB_TOKEN is the one secret allowed, because GitHub creates it for every run.

// GitHub evaluates the `secrets` context only inside `${{ }}`. The one key whose expression may
// leave out the braces, `if:`, does not accept secrets at all. A `}}` inside a single-quoted
// string, such as the one in `format('{{"a":"{0}"}}', ...)`, does not end the expression.
const EXPRESSION = /\$\{\{((?:[^'}]|'[^']*'|\}(?!\}))*)\}\}/g;
// `secrets` as a context of its own, not a property such as `needs.secrets` and not part of a
// longer name. GitHub's expression lexer skips whitespace before every token, so `secrets .NAME`,
// `secrets. NAME` and `secrets ['NAME']` read NAME as well. Any other use, such as
// `secrets[matrix.name]` or `toJSON(secrets)`, can reach every secret.
const SECRETS =
  /(?<![\w.-])secrets(?![\w-])(?:\s*\.\s*([A-Za-z_][\w-]*)|\s*\[\s*'([^']*)'\s*\])?/gi;

// Each entry of a parsed YAML document as a key and its value: the document itself under the key
// "", then every key of every mapping and every index of every list. An alias can make a parsed
// document cyclic, so each collection is read once.
const entries = (value: unknown, key = "", seen = new Set<object>()): [string, unknown][] => {
  if (typeof value !== "object" || value === null) {
    return [[key, value]];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  return [
    [key, value],
    ...Object.entries(value).flatMap(([child, inner]: [string, unknown]) =>
      entries(inner, child, seen),
    ),
  ];
};

// The secrets that the expressions in `text` read, by name where one follows the context.
const readsIn = (text: string): string[] =>
  [...text.matchAll(EXPRESSION)].flatMap(([, expression = ""]) =>
    [...expression.matchAll(SECRETS)].map(([, dotted, indexed]) => dotted ?? indexed ?? "secrets"),
  );

/**
 * The secrets that `text`, a workflow or an action, reads other than GITHUB_TOKEN: each one read
 * by name inside an expression, `secrets` for any other use of the context inside an expression,
 * and `inherit` for `secrets: inherit`, which hands every secret to a reusable workflow. It reads
 * the strings that the YAML parser returns, as GitHub does, so an expression written with a YAML
 * escape such as `\x24{{` or inside a flow mapping counts. So does an expression in a shell comment
 * inside `run:`, which GitHub expands before the shell starts, while a YAML comment does not.
 * Throws when `text` is not YAML.
 */
export const foreignSecrets = (text: string): string[] => {
  const found = new Set<string>();
  for (const [key, value] of entries(Bun.YAML.parse(text))) {
    const strings = typeof value === "string" ? [key, value] : [key];
    for (const name of strings.flatMap(readsIn)) {
      if (name.toUpperCase() !== "GITHUB_TOKEN") {
        found.add(name);
      }
    }
    if (
      key.toLowerCase() === "secrets" &&
      typeof value === "string" &&
      value.trim().toLowerCase() === "inherit"
    ) {
      found.add("inherit");
    }
  }
  return [...found];
};

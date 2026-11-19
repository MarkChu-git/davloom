// The secrets that a GitHub Actions file reads (add-ci-baseline, task 5.2). Pull request checks
// read no repository secret, so a pull request from a fork gets the same results as a branch.
// GITHUB_TOKEN is the one secret allowed, because GitHub creates it for every run.

// GitHub evaluates the `secrets` context only inside `${{ }}`. The one key whose expression may
// leave out the braces, `if:`, does not accept secrets at all.
const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g;
// `secrets` as a context of its own, not a property such as `needs.secrets` and not part of a
// longer name. GitHub's expression lexer skips whitespace before every token, so `secrets .NAME`,
// `secrets. NAME` and `secrets ['NAME']` read NAME as well. Any other use, such as
// `secrets[matrix.name]` or `toJSON(secrets)`, can reach every secret.
const SECRETS =
  /(?<![\w.-])secrets(?![\w-])(?:\s*\.\s*([A-Za-z_][\w-]*)|\s*\[\s*'([^']*)'\s*\])?/gi;
const INHERIT = /^\s*secrets\s*:\s*inherit\b/im;

/**
 * The secrets that `text`, a workflow or an action, reads other than GITHUB_TOKEN: each one read
 * by name inside an expression, `secrets` for any other use of the context inside an expression,
 * and `inherit` for `secrets: inherit`, which hands every secret to a reusable workflow. An
 * expression in a comment counts too, since GitHub expands one in a shell comment inside `run:`.
 */
export const foreignSecrets = (text: string): string[] => {
  const found = new Set<string>();
  for (const [, expression = ""] of text.matchAll(EXPRESSION)) {
    for (const [, dotted, indexed] of expression.matchAll(SECRETS)) {
      const name = dotted ?? indexed ?? "secrets";
      if (name.toUpperCase() !== "GITHUB_TOKEN") {
        found.add(name);
      }
    }
  }
  if (INHERIT.test(text)) {
    found.add("inherit");
  }
  return [...found];
};

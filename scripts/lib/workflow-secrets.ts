// The secrets that a GitHub Actions file reads (add-ci-baseline, task 5.2). Pull request checks
// read no repository secret, so a pull request from a fork gets the same results as a branch.
// GITHUB_TOKEN is the one secret allowed, because GitHub creates it for every run.

// A `secrets` context that is not a property of something else, such as `needs.secrets`.
const SECRET_PROPERTY = /(?<![\w.-])secrets(?:\.([A-Za-z_][\w-]*)|\[\s*'([^']*)'\s*\])/gi;
const SECRETS_CONTEXT = /(?<![\w.-])secrets\b(?!\s*[.[])/i;
const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g;
const INHERIT = /^\s*secrets\s*:\s*inherit\b/im;

/**
 * The secrets that `text`, a workflow or an action, reads other than GITHUB_TOKEN: each
 * `secrets.NAME` or `secrets['NAME']` by its name, the whole `secrets` context inside an
 * expression as `secrets`, and `secrets: inherit`, which hands every secret to a reusable
 * workflow, as `inherit`. Comments count too, since GitHub expands an expression in a shell
 * comment inside `run:`.
 */
export const foreignSecrets = (text: string): string[] => {
  const found = new Set<string>();
  for (const [, dotted, indexed] of text.matchAll(SECRET_PROPERTY)) {
    const name = dotted ?? indexed ?? "";
    if (name.toUpperCase() !== "GITHUB_TOKEN") {
      found.add(name);
    }
  }
  for (const [, expression = ""] of text.matchAll(EXPRESSION)) {
    if (SECRETS_CONTEXT.test(expression)) {
      found.add("secrets");
    }
  }
  if (INHERIT.test(text)) {
    found.add("inherit");
  }
  return [...found];
};

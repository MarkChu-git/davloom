import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foreignSecrets } from "./lib/workflow-secrets";

const root = fileURLToPath(new URL("..", import.meta.url));
const DEPLOY = ".github/workflows/deploy.yml";

// Every workflow and every local action, which a pull request's checks run. Bun.Glob does not
// expand braces that hold a `/`, so the two kinds take a pattern each.
const actionFiles = (): string[] =>
  [".github/workflows/*.{yml,yaml}", ".github/actions/**/action.{yml,yaml}"]
    .flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: root, dot: true })])
    .toSorted();

// A pull request from a fork gets no repository secrets, so a check that read one would pass on a
// branch and fail, or skip work, on a fork (add-ci-baseline, task 5.2).
describe("the workflows", () => {
  it("are found", () => {
    expect(actionFiles()).toEqual(
      expect.arrayContaining([".github/actions/setup/action.yml", ".github/workflows/ci.yml"]),
    );
  });

  // One test per file, so a file that is not YAML fails under its own name. Only the workflows that
  // pull requests run, and the local actions they use, are held to this; the deploy workflow runs
  // on main alone and needs the Cloudflare token.
  it.each(actionFiles().filter((file) => file !== DEPLOY))(
    "%s reads no secret other than GITHUB_TOKEN",
    (file) => {
      expect(foreignSecrets(readFileSync(join(root, file), "utf8"))).toEqual([]);
    },
  );

  it("the deploy workflow never runs for a pull request", () => {
    const text = readFileSync(join(root, DEPLOY), "utf8");
    expect(text).not.toMatch(/pull_request/);
    expect(text).toMatch(/^on:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n/m);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foreignSecrets } from "./lib/workflow-secrets";

const root = fileURLToPath(new URL("..", import.meta.url));

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

  it("read no secret other than GITHUB_TOKEN", () => {
    const reads = actionFiles()
      .map((file) => [file, foreignSecrets(readFileSync(join(root, file), "utf8"))] as const)
      .filter(([, secrets]) => secrets.length > 0);
    expect(reads).toEqual([]);
  });
});

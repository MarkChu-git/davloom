import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

const read = (path: string): string => readFileSync(join(root, path), "utf8");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The mapping in `value`, or an error that names what was expected there.
const record = (value: unknown, what: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${what} is not a mapping`);
  }
  return value;
};

const list = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${what} is not a list`);
  }
  return value;
};

// The two Rulesets that protect main, as task 7.2 of add-ci-baseline exported them, in the form
// that PUT /repos/{owner}/{repo}/rulesets/{id} takes. Decision 6 sets their rules.
const main = record(JSON.parse(read(".github/rulesets/main.json")), "main.json");
const reviews = record(JSON.parse(read(".github/rulesets/main-reviews.json")), "main-reviews.json");
const ci = record(Bun.YAML.parse(read(".github/workflows/ci.yml")), "ci.yml");
const codeql = record(Bun.YAML.parse(read(".github/workflows/codeql.yml")), "codeql.yml");

const parameters = (ruleset: Record<string, unknown>, type: string): unknown =>
  list(ruleset["rules"], "rules")
    .map((rule) => record(rule, "a rule"))
    .find((rule) => rule["type"] === type)?.["parameters"];

const jobs = (workflow: Record<string, unknown>): [string, Record<string, unknown>][] =>
  Object.entries(record(workflow["jobs"], "jobs")).map(([id, job]) => [id, record(job, id)]);

// Every workflow but ci.yml. Bun.Glob does not expand braces that hold a `/`.
const otherWorkflows = (): string[] =>
  [...new Bun.Glob(".github/workflows/*.{yml,yaml}").scanSync({ cwd: root, dot: true })]
    .filter((file) => file !== ".github/workflows/ci.yml")
    .toSorted();

// A job's check run carries its name, or its ID when it has none.
const checkNames = (workflow: Record<string, unknown>): string[] =>
  jobs(workflow)
    .map(([id, job]) => (typeof job["name"] === "string" ? job["name"] : id))
    .toSorted();

// The GitHub Actions app, which reports the check run of every workflow job.
const GITHUB_ACTIONS = 15368;

describe("the exported Rulesets", () => {
  it.each([
    ["main.json", main, "main"],
    ["main-reviews.json", reviews, "main reviews"],
  ])("%s holds only the fields that PUT takes", (_file, ruleset, name) => {
    expect(Object.keys(ruleset).toSorted()).toEqual([
      "bypass_actors",
      "conditions",
      "enforcement",
      "name",
      "rules",
      "target",
    ]);
    expect(ruleset).toMatchObject({
      name,
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    });
  });

  it("main lets nobody bypass it, the owner included", () => {
    expect(main["bypass_actors"]).toEqual([]);
  });

  it("main blocks deletion and force pushes and asks for a pull request without approvals", () => {
    expect(list(main["rules"], "rules").map((rule) => record(rule, "a rule")["type"])).toEqual(
      expect.arrayContaining(["deletion", "non_fast_forward", "pull_request"]),
    );
    expect(parameters(main, "pull_request")).toMatchObject({ required_approving_review_count: 0 });
  });

  it("main requires every job of ci.yml, as GitHub Actions reports it", () => {
    const required = list(
      record(parameters(main, "required_status_checks"), "the required checks")[
        "required_status_checks"
      ],
      "the required checks",
    ).map((check) => record(check, "a required check"));
    const contexts = required
      .map((check) => check["context"])
      .filter((context): context is string => typeof context === "string");
    expect(contexts.toSorted()).toEqual(checkNames(ci));
    expect(required.map((check) => check["integration_id"])).toEqual(
      required.map(() => GITHUB_ACTIONS),
    );
  });

  // Every other open pull request would have to rebase and run CI again after each merge.
  it("main asks for no branch that is up to date with main", () => {
    expect(parameters(main, "required_status_checks")).toMatchObject({
      strict_required_status_checks_policy: false,
    });
  });

  it("main holds a pull request back until CodeQL finds no alert at High or higher and no error", () => {
    expect(parameters(main, "code_scanning")).toEqual({
      code_scanning_tools: [
        { tool: "CodeQL", security_alerts_threshold: "high_or_higher", alerts_threshold: "errors" },
      ],
    });
  });

  it("main reviews asks for two approvals, which admins bypass on pull requests only", () => {
    expect(reviews["bypass_actors"]).toEqual([
      { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" },
    ]);
    expect(parameters(reviews, "pull_request")).toMatchObject({
      required_approving_review_count: 2,
      dismiss_stale_reviews_on_push: true,
    });
  });
});

// GitHub waits for each required check by name. A check that never reports blocks the pull request,
// and a job that an `if:` skips reports success without running.
describe("the required jobs", () => {
  it.each([
    ["ci.yml", ci],
    ["codeql.yml", codeql],
  ])("%s runs on every pull request, with no filter", (_file, workflow) => {
    const triggers = record(workflow["on"], "on");
    expect(triggers).toHaveProperty("pull_request");
    expect(triggers["pull_request"] ?? {}).toEqual({});
  });

  it.each([...jobs(ci), ...jobs(codeql)])("%s has no job-level if", (_id, job) => {
    expect(job).not.toHaveProperty("if");
  });

  // A matrix job reports one check per combination, under a name that adds the matrix values, and
  // a job that calls a reusable workflow reports its checks as `<job> / <called job>`.
  it.each(jobs(ci))("%s reports one check under its own name", (_id, job) => {
    expect(job["strategy"] ?? {}).not.toHaveProperty("matrix");
    expect(job).not.toHaveProperty("uses");
  });

  // GitHub's documentation asks for job names that are unique across workflows, because a required
  // check is matched by its name alone.
  it.each(otherWorkflows())("%s has no job with the name of a required check", (file) => {
    const required = checkNames(ci);
    const names = checkNames(record(Bun.YAML.parse(read(file)), file));
    expect(names.filter((name) => required.includes(name))).toEqual([]);
  });
});

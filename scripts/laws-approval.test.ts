import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  check,
  decide,
  GUARDED,
  LABEL,
  settings,
  type Settings,
  type Verdict,
} from "./laws-approval";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), "utf8");

type Payload = Record<string, unknown>;

const isPayload = (value: unknown): value is Payload =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The object in `value`, or an error that names what was expected there.
const payload = (value: unknown, what: string): Payload => {
  if (!isPayload(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value;
};

// One payload of each kind that GitHub's REST API returned, trimmed of its URLs: pull request #78,
// one of its changed files, a labeled event of oven-sh/bun#41151, a force-push of #71, a reopening
// of #39, a change of base and a commit of #77's timeline, a CodeQL run on #78, and #52 in the
// list of the pull requests from its head branch, which #47 came from too. Each case below copies
// them and sets the times, accounts, branches and commits it needs.
const fixture = payload(JSON.parse(read("scripts/fixtures/laws-approval.json")), "the fixture");
const part = (key: string): Payload => payload(fixture[key], key);
const recorded = {
  pullRequest: part("pullRequest"),
  file: part("file"),
  labeled: part("labeled"),
  forcePushed: part("forcePushed"),
  reopened: part("reopened"),
  baseChanged: part("baseChanged"),
  committed: part("committed"),
  run: part("run"),
  listed: part("listed"),
};
const recordedHead = payload(recorded.pullRequest["head"], "pullRequest.head");
const recordedLabel = payload(recorded.labeled["label"], "labeled.label");
const recordedActor = payload(recorded.labeled["actor"], "labeled.actor");
const recordedRepository = payload(recorded.run["head_repository"], "run.head_repository");
const recordedOwner = payload(recordedRepository["owner"], "run.head_repository.owner");

const OWNER = { login: "MarkChu-git", id: 182319871, type: "User" };
const REPOSITORY = "MarkChu-git/davloom";
const FORK = "contributor/davloom";
const BRANCH = "phase-1-laws-approval";
// The pull request that each case checks.
const NUMBER = 7;
// Three heads, oldest first.
const A = "1".repeat(40);
const B = "2".repeat(40);
const C = "3".repeat(40);

// 2026-11-20T09:00:00Z plus `seconds`, in GitHub's format.
const at = (seconds: number): string =>
  new Date(Date.UTC(2026, 10, 20, 9, 0, seconds)).toISOString().replace(".000Z", "Z");

const repository = (fullName: string): Payload => ({
  ...recordedRepository,
  full_name: fullName,
  fork: fullName !== REPOSITORY,
  owner: { ...recordedOwner, login: fullName.split("/")[0] ?? "" },
});

const changed = (filename: string, change: Payload = {}): Payload => ({
  ...recorded.file,
  filename,
  ...change,
});
const LAWS = changed("packages/laws/LAWS.bend");

const labeled = (seconds: number, actor: Payload = OWNER, name = LABEL): Payload => ({
  ...recorded.labeled,
  actor,
  created_at: at(seconds),
  label: { ...recordedLabel, name },
});
const unlabeled = (seconds: number, actor: Payload = OWNER): Payload => ({
  ...labeled(seconds, actor),
  event: "unlabeled",
});
const forcePushed = (seconds: number, commit: string): Payload => ({
  ...recorded.forcePushed,
  commit_id: commit,
  created_at: at(seconds),
});
const reopened = (seconds: number): Payload => ({ ...recorded.reopened, created_at: at(seconds) });
const baseChanged = (seconds: number): Payload => ({
  ...recorded.baseChanged,
  created_at: at(seconds),
});
const restored = (seconds: number): Payload => ({
  ...recorded.reopened,
  event: "head_ref_restored",
  created_at: at(seconds),
});

const run = (head: string, seconds: number, change: Payload = {}): Payload => ({
  ...recorded.run,
  name: "Laws approval",
  path: ".github/workflows/laws-approval.yml",
  head_branch: BRANCH,
  head_sha: head,
  created_at: at(seconds),
  run_started_at: at(seconds),
  ...change,
});
const forkRun = (head: string, seconds: number): Payload =>
  run(head, seconds, { head_repository: repository(FORK) });

interface Case {
  head?: string;
  labels?: string[];
  files?: Payload[];
  changedFiles?: number;
  timeline?: Payload[];
  runs?: Payload[];
  // The pull request's head repository, or null once it is deleted, and its head branch.
  from?: string | null;
  branch?: string;
  // The head of the event that started the run, when it is not the pull request's head.
  eventHead?: string;
  // The other pull requests from the head branch, which GitHub lists after this one, or the whole
  // list of the pull requests from it when `fromHead` is set.
  others?: Payload[];
  fromHead?: Payload[];
}

const pullRequest = (c: Case): Payload => {
  const head = c.head ?? A;
  const from = c.from === undefined ? REPOSITORY : c.from;
  const branch = c.branch ?? BRANCH;
  return {
    ...recorded.pullRequest,
    number: NUMBER,
    labels: (c.labels ?? []).map((name, index) => ({ id: index + 1, name, color: "0e8a16" })),
    changed_files: c.changedFiles ?? (c.files ?? [LAWS]).length,
    head: {
      ...recordedHead,
      label: `${(from ?? REPOSITORY).split("/")[0] ?? ""}:${branch}`,
      ref: branch,
      sha: head,
      repo: from === null ? null : repository(from),
    },
  };
};

// The states of a pull request in GitHub's list of the pull requests from a head.
const OPEN = { state: "open", closed_at: null, merged_at: null, merge_commit_sha: null };
const CLOSED = { state: "closed", closed_at: at(-60), merged_at: null, merge_commit_sha: null };
const MERGED = { state: "closed", closed_at: at(-60), merged_at: at(-60) };

// Pull request `number`, from the head of `pull`, as GitHub lists the pull requests from a head.
const listing = (number: number, pull: Payload, state: Payload = OPEN): Payload => ({
  ...recorded.listed,
  number,
  head: pull["head"],
  base: pull["base"],
  ...state,
});
const fromHead = (c: Case): Payload[] =>
  c.fromHead ?? [listing(NUMBER, pullRequest(c)), ...(c.others ?? [])];

const verdict = (c: Case = {}): Verdict =>
  decide(
    {
      pullRequest: pullRequest(c),
      files: c.files ?? [LAWS],
      timeline: c.timeline ?? [],
      runs: c.runs ?? [],
      fromHead: fromHead(c),
    },
    { headSha: c.eventHead ?? c.head ?? A, ownerId: OWNER.id },
  );

// A pull request that changes LAWS.bend and carries the label.
const approved = (c: Case): Verdict => verdict({ labels: [LABEL], ...c });

describe("the laws-approved decision", () => {
  it("A law change without approval", () => {
    const result = verdict({ runs: [run(A, 0)] });
    expect(result.pass).toBe(false);
    expect(result.message).toBe(
      `The pull request changes packages/laws/LAWS.bend, so it needs the owner's ${LABEL} label, added after its last commit. The label is not on it.`,
    );
  });

  it("The owner's approval", () => {
    // The owner adds the label after the run that the pull request's opening started.
    expect(approved({ timeline: [labeled(10)], runs: [run(A, 0)] })).toEqual({
      pass: true,
      message: `The pull request changes packages/laws/LAWS.bend, and the owner added ${LABEL} at ${at(10)}, after ${A} became the head at ${at(0)}.`,
    });
    // A commit is pushed afterwards. The label stays on the pull request, and the runs list newest
    // first: the push's run, the run that the label started and the opening's run.
    const pushed = approved({
      head: B,
      timeline: [labeled(10)],
      runs: [run(B, 20), run(A, 11), run(A, 0)],
    });
    expect(pushed.pass).toBe(false);
    expect(pushed.message).toContain(
      `The owner added the label at ${at(10)}, which is not after ${at(20)}, when ${B} became the head.`,
    );
  });

  it("A label from another account", () => {
    // The recorded event as GitHub returned it, from robobun, for this label.
    const result = approved({ timeline: [labeled(10, recordedActor)], runs: [run(A, 0)] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain("robobun added the label, not the owner.");
  });

  it("a label from an account with the owner's login and another ID", () => {
    // A login that the owner gives up can pass to another account, so only the owner's ID counts.
    const result = approved({
      timeline: [labeled(10, { ...OWNER, id: OWNER.id + 1 })],
      runs: [run(A, 0)],
    });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(`${OWNER.login} added the label, not the owner.`);
    // The owner keeps its ID under a new login.
    const renamed = { ...OWNER, login: "renamed-owner" };
    expect(approved({ timeline: [labeled(10, renamed)], runs: [run(A, 0)] }).pass).toBe(true);
  });

  it("A pull request that changes the check", () => {
    // The pull request edits the script and keeps its list of guarded files, which is this one.
    const result = verdict({ files: [changed("scripts/laws-approval.ts")], runs: [run(A, 0)] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain("The pull request changes scripts/laws-approval.ts");
    expect(GUARDED).toContain("scripts/laws-approval.ts");
  });

  it("A pull request that leaves the laws alone", () => {
    const result = verdict({
      files: [
        changed("packages/core/src/index.ts"),
        changed("tests/fixtures/laws/LAWS.bend", { status: "added" }),
        changed("packages/laws/src/README.md"),
        changed(".github/workflows/ci.yml"),
      ],
    });
    expect(result).toEqual({
      pass: true,
      message: "The pull request changes no guarded file, so it needs no label.",
    });
  });

  it.each([
    [".github/workflows/laws-approval.yml"],
    ["scripts/laws-approval.ts"],
    ["bunfig.toml"],
    ["packages/laws/LAWS.bend"],
  ])("guards %s", (path) => {
    expect(verdict({ files: [changed(path)], runs: [run(A, 0)] }).pass).toBe(false);
  });

  it("names every guarded file that the pull request changes", () => {
    const result = verdict({ files: [LAWS, changed("bunfig.toml"), changed("README.md")] });
    expect(result.message).toMatch(
      /^The pull request changes packages\/laws\/LAWS\.bend and bunfig\.toml, so/,
    );
  });

  it("a change to bunfig.toml, and not to one in a package", () => {
    expect(verdict({ files: [changed("bunfig.toml")] }).pass).toBe(false);
    // Bun reads only the root's bunfig.toml when it runs the script.
    expect(verdict({ files: [changed("packages/laws/bunfig.toml")] }).pass).toBe(true);
  });

  it("a removed LAWS.bend", () => {
    const result = verdict({ files: [changed("packages/laws/LAWS.bend", { status: "removed" })] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain("changes packages/laws/LAWS.bend");
  });

  it.each([
    ["away from its place", "packages/laws/OLD_LAWS.bend", "packages/laws/LAWS.bend"],
    ["into its place", "packages/laws/LAWS.bend", "packages/laws/draft.bend"],
  ])("a moved LAWS.bend: %s", (_where, filename, previous) => {
    const result = verdict({
      files: [changed(filename, { status: "renamed", previous_filename: previous })],
    });
    expect(result.pass).toBe(false);
    expect(result.message).toContain("changes packages/laws/LAWS.bend");
  });

  it("more files than GitHub lists", () => {
    const result = verdict({
      files: [changed("README.md"), changed("docs/ci.md")],
      changedFiles: 5,
    });
    expect(result.pass).toBe(false);
    expect(result.message).toContain("changes 3 files that GitHub does not list, so");
    expect(verdict({ files: [changed("README.md")], changedFiles: 2 }).message).toContain(
      "changes 1 file that GitHub does not list, so",
    );
  });

  it("a head that moved after the run started", () => {
    const result = approved({ head: B, eventHead: A, timeline: [labeled(30)], runs: [run(B, 20)] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(
      `Its head is ${B} now, not ${A}, which this run checks; the run for the new head decides.`,
    );
  });

  it("a label that is no longer on the pull request", () => {
    expect(verdict({ timeline: [labeled(10)], runs: [run(A, 0)] }).message).toContain(
      "The label is not on it.",
    );
  });

  it("a label that the timeline shows removed after it was added", () => {
    // The pull request was read before the removal, and the timeline after it.
    const result = approved({ timeline: [labeled(10), unlabeled(12)], runs: [run(A, 0)] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(`the label removed at ${at(12)}, after it was last added`);
    // A removal and an addition in one second keep the timeline's order.
    expect(approved({ timeline: [unlabeled(12), labeled(12)], runs: [run(A, 0)] }).pass).toBe(true);
    expect(approved({ timeline: [labeled(12), unlabeled(12)], runs: [run(A, 0)] }).pass).toBe(
      false,
    );
  });

  it("a label that the owner removes and adds again after a new head", () => {
    const timeline = [labeled(10), unlabeled(25), labeled(26)];
    expect(approved({ head: B, timeline, runs: [run(B, 20), run(A, 0)] }).pass).toBe(true);
  });

  it("another label from the owner", () => {
    const result = approved({ timeline: [labeled(10, OWNER, "bug")], runs: [run(A, 0)] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain("Its timeline holds no event that added the label.");
  });

  it("a label from an account that GitHub no longer names", () => {
    const result = approved({ timeline: [{ ...labeled(10), actor: null }], runs: [run(A, 0)] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain("an account that GitHub does not name added the label");
  });

  it("a label in the same second as the head", () => {
    const same = approved({ timeline: [labeled(10)], runs: [run(A, 10)] });
    expect(same.pass).toBe(false);
    expect(same.message).toContain(`at ${at(10)}, which is not after ${at(10)}`);
    expect(approved({ timeline: [labeled(11)], runs: [run(A, 10)] }).pass).toBe(true);
  });

  it("a pull request without a run of this workflow", () => {
    const result = approved({ timeline: [labeled(10)] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(`GitHub lists no run of this workflow for ${A}`);
  });

  it("other timeline events, which carry no time or another label", () => {
    const timeline = [
      recorded.committed,
      labeled(5, OWNER, "bug"),
      labeled(10),
      recorded.committed,
    ];
    expect(approved({ timeline, runs: [run(A, 0)] }).pass).toBe(true);
  });
});

describe("when the head became the head", () => {
  // A was the head and approved at 10. B was pushed at 20, and a force-push at 30 brought A back,
  // whose new run came at 33.
  const back = [forcePushed(30, A)];
  it.each([
    ["with every run", [run(A, 33), run(B, 20), run(A, 11), run(A, 0)]],
    ["with A's older runs deleted", [run(A, 33), run(B, 20)]],
    ["with B's runs deleted", [run(A, 33), run(A, 11), run(A, 0)]],
    ["with A's older runs and B's runs deleted", [run(A, 33)]],
  ])("a force-push back to an older commit, %s", (_runs, runs) => {
    const result = approved({ timeline: [labeled(10), ...back], runs });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(`which is not after ${at(33)}, when ${A} became the head`);
    // The owner approves the head again after the force-push.
    const again = [labeled(10), ...back, unlabeled(40), labeled(41)];
    expect(approved({ timeline: again, runs }).pass).toBe(true);
  });

  it("a force-push to an older commit and a fast-forward back, with the older commit's runs deleted", () => {
    // A at 0, B pushed at 10 and approved at 15, a force-push to A at 20, whose run came at 22,
    // and a fast-forward back to B, whose run came at 30. A's runs at 0 and 22 are deleted.
    const result = approved({
      head: B,
      timeline: [labeled(15), forcePushed(20, A)],
      runs: [run(B, 30), run(B, 10)],
    });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(`which is not after ${at(30)}, when ${B} became the head`);
  });

  it("a head with no run after the latest force-push", () => {
    // B had a run at 5, and a force-push at 20 made it the head again, whose runs are deleted.
    const result = approved({
      head: B,
      timeline: [labeled(30), forcePushed(20, B)],
      runs: [run(B, 5), run(A, 0)],
    });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(
      `No run of this workflow for ${B} comes after ${at(20)}, the latest force-push, restored branch, reopening, change of base or run for another head`,
    );
  });

  it("a run in the same second as the latest force-push", () => {
    const result = approved({ timeline: [forcePushed(20, A), labeled(30)], runs: [run(A, 20)] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(`No run of this workflow for ${A} comes after ${at(20)}`);
  });

  it("a reopened pull request with a new head", () => {
    // Approved at 10 on A, closed at 20, B pushed while closed, which starts no run, and reopened
    // at 30, whose run came at 31.
    const result = approved({
      head: B,
      timeline: [labeled(10), reopened(30)],
      runs: [run(B, 31), run(A, 11), run(A, 0)],
    });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(`which is not after ${at(31)}, when ${B} became the head`);
  });

  it("a reopened pull request with the same head", () => {
    const runs = [run(A, 31), run(A, 11), run(A, 0)];
    expect(approved({ timeline: [labeled(10), reopened(30)], runs }).pass).toBe(false);
    const again = [labeled(10), reopened(30), unlabeled(40), labeled(41)];
    expect(approved({ timeline: again, runs }).pass).toBe(true);
  });

  it("a restored head branch", () => {
    const runs = [run(A, 32), run(A, 0)];
    expect(approved({ timeline: [labeled(10), restored(30)], runs }).pass).toBe(false);
    expect(approved({ timeline: [restored(30), labeled(40)], runs }).pass).toBe(true);
  });

  it("a pull request whose base changed", () => {
    // Approved at 10, and its base changed at 30, which changes what it would merge. The run that
    // the edited event started came at 32.
    const runs = [run(A, 32), run(A, 11), run(A, 0)];
    const result = approved({ timeline: [labeled(10), baseChanged(30)], runs });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(`which is not after ${at(32)}, when ${A} became the head`);
    // The owner approves it again after the change.
    const again = [labeled(10), baseChanged(30), unlabeled(40), labeled(41)];
    expect(approved({ timeline: again, runs }).pass).toBe(true);
  });

  it("a run that GitHub cancelled", () => {
    // B's first run was cancelled as soon as it started. It still marks when B became the head.
    const runs = [run(B, 10, { status: "completed", conclusion: "cancelled" }), run(A, 0)];
    expect(approved({ head: B, timeline: [labeled(15)], runs }).pass).toBe(true);
    expect(approved({ head: B, timeline: [labeled(5)], runs }).pass).toBe(false);
    // A cancelled run for another head still counts as one.
    const other = [run(B, 20), run(A, 10, { conclusion: "cancelled" }), run(B, 5)];
    expect(approved({ head: B, timeline: [labeled(15)], runs: other }).pass).toBe(false);
  });

  it("a pull request from a fork", () => {
    const runs = [forkRun(B, 20), forkRun(A, 0)];
    expect(approved({ from: FORK, head: B, timeline: [labeled(30)], runs }).pass).toBe(true);
    expect(approved({ from: FORK, head: B, timeline: [labeled(15)], runs }).pass).toBe(false);
  });

  it("a fork branch with the pull request's branch name", () => {
    // B was pushed to this repository's branch at 20, after the label. A fork's branch of the same
    // name ran B at 5, which is another branch's run.
    const runs = [run(B, 20), forkRun(B, 5), run(A, 0)];
    const result = approved({ head: B, timeline: [labeled(10)], runs });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(`which is not after ${at(20)}, when ${B} became the head`);
    // And the other way round: this repository's branch of the fork's name.
    const fromFork = [forkRun(B, 20), run(B, 5), forkRun(A, 0)];
    expect(approved({ from: FORK, head: B, timeline: [labeled(10)], runs: fromFork }).pass).toBe(
      false,
    );
  });

  it("runs of another branch", () => {
    // GitHub lists the runs of the head branch, and the check keeps only those. A run of A on
    // another branch at 5 would otherwise be A's start, before the label at 10.
    const early = [run(A, 20), run(A, 5, { head_branch: "another-branch" })];
    expect(approved({ timeline: [labeled(10)], runs: early }).pass).toBe(false);
    // And a run of B on another branch at 5 would otherwise come after A's start at 0.
    const between = [run(B, 5, { head_branch: "another-branch" }), run(A, 0)];
    expect(approved({ timeline: [labeled(10)], runs: between }).pass).toBe(true);
  });

  it("runs of other events", () => {
    // Only pull_request runs mark a head. A run of B that another event started does not.
    const runs = [run(B, 20), run(B, 5, { event: "workflow_dispatch" }), run(A, 0)];
    expect(approved({ head: B, timeline: [labeled(10)], runs }).pass).toBe(false);
  });

  it("a head repository that no longer exists", () => {
    const result = approved({ from: null, timeline: [labeled(10)], runs: [run(A, 0)] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain("Its head repository no longer exists");
  });

  it("a third head after two others", () => {
    const runs = [run(C, 40), run(B, 20), run(A, 0)];
    expect(approved({ head: C, timeline: [labeled(41)], runs }).pass).toBe(true);
    expect(approved({ head: C, timeline: [labeled(30)], runs }).pass).toBe(false);
  });
});

// The reason the check gives when `others` came from the head branch too.
const reused = (others: string): string =>
  `${others} also came from the branch ${BRANCH} of ${REPOSITORY}, and this workflow's runs do not show which pull request they ran for. Open the pull request again from a new branch, and close this one.`;

// A run names no pull request for a fork, so the runs of a head branch belong to one pull request
// only when no other pull request came from that branch.
describe("other pull requests from the head branch", () => {
  it("a head that another pull request from the branch ran before", () => {
    // #5 came from the branch with head C, whose run came at 0, and was closed. A force-push took
    // the branch back to A, C's parent, which conflicts with main, so opening this pull request
    // from it started no run. The owner added the label at 20. C was pushed at 30, a fast-forward
    // that the timeline does not show, and its run came at 32.
    const c: Case = { head: C, timeline: [labeled(20)], runs: [run(C, 32), run(C, 0)] };
    // The runs alone would show C as the head since 0.
    expect(approved({ ...c, fromHead: [listing(NUMBER, pullRequest(c))] }).pass).toBe(true);
    const result = approved({ ...c, others: [listing(5, pullRequest(c), CLOSED)] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(reused("Pull request #5"));
  });

  it.each([
    ["closed", CLOSED],
    ["merged", MERGED],
    ["open", OPEN],
  ])("another pull request from the branch, %s", (_state, state) => {
    const others = [listing(5, pullRequest({}), state)];
    const result = approved({ timeline: [labeled(10)], runs: [run(A, 0)], others });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(reused("Pull request #5"));
  });

  it("several other pull requests from the branch", () => {
    // #52 comes twice, as when a pull request opens between the reads of two pages of the list.
    const pull = pullRequest({});
    const others = [
      listing(52, pull, MERGED),
      listing(47, pull, CLOSED),
      listing(52, pull, MERGED),
    ];
    const result = approved({ timeline: [labeled(10)], runs: [run(A, 0)], others });
    expect(result.message).toContain(reused("Pull requests #52 and #47"));
  });

  it("another pull request from a fork's branch", () => {
    const c: Case = { from: FORK, timeline: [labeled(10)], runs: [forkRun(A, 0)] };
    expect(approved(c).pass).toBe(true);
    const result = approved({ ...c, others: [listing(5, pullRequest(c), MERGED)] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(
      `Pull request #5 also came from the branch ${BRANCH} of ${FORK}`,
    );
  });

  it("names the other pull request before the label is on", () => {
    const result = verdict({ runs: [run(A, 0)], others: [listing(5, pullRequest({}), CLOSED)] });
    expect(result.message).toContain(reused("Pull request #5"));
  });

  it("a pull request that GitHub does not list among those from its head", () => {
    const result = approved({ timeline: [labeled(10)], runs: [run(A, 0)], fromHead: [] });
    expect(result.pass).toBe(false);
    expect(result.message).toContain(
      `GitHub does not list it among the pull requests from the branch ${BRANCH} of ${REPOSITORY}, so the check cannot tell whether another one came from there.`,
    );
  });
});

describe("records of another shape", () => {
  const records = () => ({
    pullRequest: pullRequest({ labels: [LABEL] }),
    files: [LAWS],
    timeline: [labeled(10)],
    runs: [run(A, 0)],
    fromHead: [listing(NUMBER, pullRequest({}))],
  });
  const context = { headSha: A, ownerId: OWNER.id };

  it("pass with the payloads as recorded", () => {
    expect(decide(records(), context).pass).toBe(true);
  });

  it.each([
    [
      "a pull request without a head",
      { pullRequest: { ...pullRequest({}), head: undefined } },
      "the head is not an object",
    ],
    [
      "a file without a name",
      { files: [{ ...LAWS, filename: 7 }] },
      "changed file 1 has no filename",
    ],
    [
      "a file with an old name that is not a string",
      { files: [{ ...LAWS, previous_filename: 7 }] },
      "changed file 1 has a previous_filename that is not a string",
    ],
    [
      "a count of files that is not one",
      { pullRequest: { ...pullRequest({ labels: [LABEL] }), changed_files: "13" } },
      "the pull request has no changed_files",
    ],
    [
      "labels that are not a list",
      { pullRequest: { ...pullRequest({ files: [LAWS] }), labels: null } },
      "the pull request has no labels list",
    ],
    [
      "an event without a kind",
      { timeline: [{ ...labeled(10), event: undefined }] },
      "timeline event 1 has no event",
    ],
    [
      "a labeled event without a time",
      { timeline: [{ ...labeled(10), created_at: undefined }] },
      "timeline event 1 has no created_at",
    ],
    [
      "a reset with a time that is not one",
      { timeline: [labeled(10), { ...forcePushed(5, A), created_at: "yesterday" }] },
      "timeline event 2 has a created_at that is not a time",
    ],
    [
      "a pull request without a number",
      { pullRequest: { ...pullRequest({ labels: [LABEL] }), number: null } },
      "the pull request has no number",
    ],
    [
      "a pull request from the head without a number",
      { fromHead: [{ ...listing(NUMBER, pullRequest({})), number: "7" }] },
      "pull request 1 from the head has no number",
    ],
    ["a run without a head", { runs: [{ ...run(A, 0), head_sha: null }] }, "run 1 has no head_sha"],
    ["a run that is not an object", { runs: [[]] }, "run 1 is not an object"],
  ])("throw on %s", (_what, change, message) => {
    expect(() => decide({ ...records(), ...change }, context)).toThrow(message);
  });
});

// What a fake API saw of a request. Bun can empty a request's URL and headers once the server has
// answered it, so the fake copies them while it answers.
interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
}

// A fake GitHub API that answers each request with `answer` and records it.
interface Fake {
  url: string;
  requests: Seen[];
  stop: () => Promise<void>;
}
const servers: Fake[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => await server.stop()));
});

const fake = (answer: (url: URL, request: Request) => Response | Promise<Response>): Fake => {
  const requests: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers),
      });
      return await answer(new URL(request.url), request);
    },
  });
  const made = {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    stop: async () => await server.stop(true),
  };
  servers.push(made);
  return made;
};

const RUN_ID = 555;
const WORKFLOW_ID = 4242;
const PREFIX = `/repos/${REPOSITORY}`;

const options = (api: string): Settings => ({
  api,
  repository: REPOSITORY,
  token: "test-token",
  number: NUMBER,
  runId: RUN_ID,
  headSha: A,
  ownerId: OWNER.id,
});

// The list in `all` cut into GitHub's pages of 100, by the page in the query.
const page = (url: URL, all: unknown[]): unknown[] => {
  const number = Number(url.searchParams.get("page"));
  return all.slice((number - 1) * 100, number * 100);
};

// The records of one pull request, served as GitHub's REST API serves them.
const github = (c: {
  pull?: Payload;
  files?: unknown[];
  timeline?: unknown[];
  runs?: unknown[];
  branch?: string;
  // The pull requests of every state and from every head, which GitHub lists by head.
  pulls?: Payload[];
}) => {
  const branch = c.branch ?? BRANCH;
  const pull = c.pull ?? pullRequest({ labels: [LABEL], branch });
  const pulls = c.pulls ?? [listing(NUMBER, pull)];
  return (url: URL): Response => {
    switch (url.pathname) {
      case `${PREFIX}/pulls`: {
        // GitHub lists only the open pull requests unless it is asked for every state.
        const state = url.searchParams.get("state") ?? "open";
        const head = url.searchParams.get("head");
        const all = pulls.filter(
          (listed) =>
            payload(listed["head"], "the head")["label"] === head &&
            (state === "all" || listed["state"] === state),
        );
        return Response.json(page(url, all));
      }
      case `${PREFIX}/pulls/${NUMBER}`:
        return Response.json(pull);
      case `${PREFIX}/pulls/${NUMBER}/files`:
        return Response.json(page(url, c.files ?? [LAWS]));
      case `${PREFIX}/issues/${NUMBER}/timeline`:
        return Response.json(page(url, c.timeline ?? [labeled(10)]));
      case `${PREFIX}/actions/runs/${RUN_ID}`:
        return Response.json({ ...run(A, 0), id: RUN_ID, workflow_id: WORKFLOW_ID });
      case `${PREFIX}/actions/workflows/${WORKFLOW_ID}/runs`: {
        const all = c.runs ?? [run(A, 0, { head_branch: branch })];
        return Response.json({ total_count: all.length, workflow_runs: page(url, all) });
      }
      default:
        return Response.json({ message: "Not Found" }, { status: 404 });
    }
  };
};

// The path and query of each request that a fake API saw.
const asked = (api: Fake): string[] =>
  api.requests.map((request) => {
    const url = new URL(request.url);
    return `${url.pathname}${url.search}`;
  });

describe("reading GitHub's records", () => {
  it("reads every page, its own run's workflow, that workflow's runs for the head branch and the pull requests from it", async () => {
    const unguarded = Array.from({ length: 100 }, (_, index) => changed(`docs/${index}.md`));
    // A branch name with characters that a query has to escape.
    const branch = "phase-1/laws+approval#2";
    const api = fake(
      github({
        files: [...unguarded, LAWS],
        branch,
        runs: [run(A, 0, { head_branch: branch })],
      }),
    );
    const result = await check(options(api.url), 0);
    expect(result.pass).toBe(true);
    expect(asked(api)).toEqual([
      `${PREFIX}/pulls/${NUMBER}`,
      `${PREFIX}/pulls/${NUMBER}/files?per_page=100&page=1`,
      `${PREFIX}/pulls/${NUMBER}/files?per_page=100&page=2`,
      `${PREFIX}/issues/${NUMBER}/timeline?per_page=100&page=1`,
      `${PREFIX}/actions/runs/${RUN_ID}`,
      `${PREFIX}/actions/workflows/${WORKFLOW_ID}/runs?branch=phase-1%2Flaws%2Bapproval%232&event=pull_request&per_page=100&page=1`,
      `${PREFIX}/pulls?state=all&head=MarkChu-git%3Aphase-1%2Flaws%2Bapproval%232&per_page=100&page=1`,
    ]);
    for (const request of api.requests) {
      expect(request.method).toBe("GET");
      expect(request.headers).toMatchObject({
        authorization: "Bearer test-token",
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      });
    }
  });

  it("decides on what it reads", async () => {
    const api = fake(github({ timeline: [labeled(10, recordedActor)] }));
    const result = await check(options(api.url), 0);
    expect(result.pass).toBe(false);
    expect(result.message).toContain("robobun added the label, not the owner.");
  });

  it("fails when GitHub lists another pull request from the head branch", async () => {
    // The case of "a head that another pull request from the branch ran before", as GitHub serves
    // it, with a pull request from another branch that the list leaves out.
    const pull = pullRequest({ labels: [LABEL], head: C });
    const api = fake(
      github({
        pull,
        timeline: [labeled(20)],
        runs: [run(C, 32), run(C, 0)],
        pulls: [
          listing(NUMBER, pull),
          listing(9, pullRequest({ branch: "another-branch" })),
          listing(5, pull, CLOSED),
        ],
      }),
    );
    const result = await check({ ...options(api.url), headSha: C }, 0);
    expect(result.pass).toBe(false);
    expect(result.message).toContain(
      `Pull request #5 also came from the branch ${BRANCH} of ${REPOSITORY}`,
    );
  });

  it("names a fork's head by the fork's owner", async () => {
    // #5 came from this repository's branch of the same name, which is another head.
    const pull = pullRequest({ labels: [LABEL], from: FORK });
    const api = fake(
      github({
        pull,
        runs: [forkRun(A, 0)],
        pulls: [listing(NUMBER, pull), listing(5, pullRequest({}), MERGED)],
      }),
    );
    expect((await check(options(api.url), 0)).pass).toBe(true);
    expect(asked(api)).toContain(
      `${PREFIX}/pulls?state=all&head=contributor%3A${BRANCH}&per_page=100&page=1`,
    );
  });

  it("reads no pull requests from a head repository that no longer exists", async () => {
    const api = fake(github({ pull: pullRequest({ labels: [LABEL], from: null }) }));
    const result = await check(options(api.url), 0);
    expect(result.message).toContain("Its head repository no longer exists");
    expect(asked(api).filter((path) => path.startsWith(`${PREFIX}/pulls?`))).toEqual([]);
  });

  it("tries a request again after a server error", async () => {
    const answer = github({});
    let errors = 0;
    const api = fake((url) => {
      if (url.pathname === `${PREFIX}/issues/${NUMBER}/timeline` && errors < 2) {
        errors += 1;
        return new Response("Bad Gateway", { status: 502 });
      }
      return answer(url);
    });
    expect((await check(options(api.url), 0)).pass).toBe(true);
    expect(errors).toBe(2);
  });

  it("gives up after three server errors", async () => {
    const api = fake(() => new Response("Service Unavailable", { status: 503 }));
    await expect(check(options(api.url), 0)).rejects.toThrow(
      `GET ${PREFIX}/pulls/${NUMBER} answered 503: Service Unavailable`,
    );
    expect(api.requests).toHaveLength(3);
  });

  it("gives up after three failed connections", async () => {
    // Nothing listens on the discard port, so every attempt fails before an answer.
    const attempts = vi.spyOn(globalThis, "fetch");
    try {
      await expect(check(options("http://127.0.0.1:9"), 0)).rejects.toThrow(
        `GET ${PREFIX}/pulls/${NUMBER} failed`,
      );
      expect(attempts).toHaveBeenCalledTimes(3);
    } finally {
      attempts.mockRestore();
    }
  });

  it("stops at a refusal", async () => {
    const answer = github({});
    const api = fake((url) =>
      url.pathname.endsWith("/timeline")
        ? Response.json({ message: "Resource not accessible by integration" }, { status: 403 })
        : answer(url),
    );
    await expect(check(options(api.url), 0)).rejects.toThrow(
      `GET ${PREFIX}/issues/${NUMBER}/timeline?per_page=100&page=1 answered 403`,
    );
    expect(api.requests.filter((request) => request.url.includes("/timeline"))).toHaveLength(1);
  });

  it("refuses a timeline longer than it reads", async () => {
    const full = Array.from({ length: 100 }, () => recorded.committed);
    const answer = github({});
    const api = fake((url) =>
      url.pathname.endsWith("/timeline") ? Response.json(full) : answer(url),
    );
    await expect(check(options(api.url), 0)).rejects.toThrow(
      `repos/${REPOSITORY}/issues/${NUMBER}/timeline lists more than 10000 entries`,
    );
  });

  it("refuses a list of runs longer than it reads", async () => {
    const full = Array.from({ length: 100 }, () => run(A, 0));
    const answer = github({});
    const api = fake((url) =>
      url.pathname.endsWith(`/workflows/${WORKFLOW_ID}/runs`)
        ? Response.json({ total_count: 1000, workflow_runs: full })
        : answer(url),
    );
    await expect(check(options(api.url), 0)).rejects.toThrow("lists more than 1000 entries");
  });

  it("counts the files beyond GitHub's 3,000 as guarded", async () => {
    const files = Array.from({ length: 3000 }, (_, index) => changed(`docs/${index}.md`));
    const pull = { ...pullRequest({ labels: [LABEL] }), changed_files: 3001 };
    const api = fake(github({ pull, files, timeline: [] }));
    const result = await check(options(api.url), 0);
    expect(result.pass).toBe(false);
    expect(result.message).toContain("changes 1 file that GitHub does not list");
    expect(api.requests.filter((request) => request.url.includes("/files"))).toHaveLength(30);
    expect(asked(api)).toContain(`${PREFIX}/issues/${NUMBER}/timeline?per_page=100&page=1`);
  });

  it("reads nothing more for a pull request that changes no guarded file", async () => {
    // Every other read fails, as it would for a refused token or a branch with too many runs.
    const answer = github({ files: [changed("README.md"), changed("docs/ci.md")] });
    const api = fake((url) =>
      url.pathname === `${PREFIX}/pulls/${NUMBER}` ||
      url.pathname === `${PREFIX}/pulls/${NUMBER}/files`
        ? answer(url)
        : Response.json({ message: "Resource not accessible by integration" }, { status: 403 }),
    );
    expect(await check(options(api.url), 0)).toEqual({
      pass: true,
      message: "The pull request changes no guarded file, so it needs no label.",
    });
    expect(asked(api)).toEqual([
      `${PREFIX}/pulls/${NUMBER}`,
      `${PREFIX}/pulls/${NUMBER}/files?per_page=100&page=1`,
    ]);
  });
});

describe("the settings", () => {
  const variables = {
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_TOKEN: "ghs_secret",
    PR_NUMBER: "7",
    GITHUB_RUN_ID: "555",
    HEAD_SHA: A,
    OWNER_ID: String(OWNER.id),
  };

  it("come from the variables that the workflow and GitHub Actions set", () => {
    expect(settings(variables)).toEqual({
      ...options("https://api.github.com"),
      token: "ghs_secret",
    });
  });

  it.each(Object.keys(variables))("refuse a missing %s", (name) => {
    expect(() => settings({ ...variables, [name]: undefined })).toThrow(`${name} is not set`);
  });

  it.each([
    ["PR_NUMBER", "7; rm -rf /"],
    ["PR_NUMBER", "0"],
    ["OWNER_ID", "MarkChu-git"],
    ["HEAD_SHA", "HEAD"],
    ["GITHUB_REPOSITORY", "../../etc"],
    ["GITHUB_API_URL", "api.github.com"],
    ["GITHUB_TOKEN", "a token"],
  ])("refuse a malformed %s without naming its value", (name, value) => {
    expect(() => settings({ ...variables, [name]: value })).toThrow(
      new Error(`${name} is malformed`),
    );
  });
});

// The script as the workflow runs it, against the fake API.
const script = async (
  variables: Record<string, string>,
): Promise<{ code: number; output: string }> => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "scripts/laws-approval.ts"], {
    cwd: root,
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...variables },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, output: `${stdout}${stderr}` };
};

// The variables that the workflow and GitHub Actions give the script.
const variables = (api: string): Record<string, string> => ({
  GITHUB_API_URL: api,
  GITHUB_REPOSITORY: REPOSITORY,
  GITHUB_TOKEN: "test-token",
  PR_NUMBER: String(NUMBER),
  GITHUB_RUN_ID: String(RUN_ID),
  HEAD_SHA: A,
  OWNER_ID: String(OWNER.id),
});

describe("the script", () => {
  it("passes with the owner's label", async () => {
    const api = fake(github({}));
    const { code, output } = await script(variables(api.url));
    expect(output).toContain(`the owner added ${LABEL} at ${at(10)}`);
    expect(code).toBe(0);
  });

  it("fails with an error that GitHub shows on the pull request", async () => {
    const api = fake(github({ pull: pullRequest({}) }));
    const { code, output } = await script(variables(api.url));
    expect(output).toContain(
      `::error title=${LABEL}::The pull request changes packages/laws/LAWS.bend, so it needs the owner's ${LABEL} label, added after its last commit. The label is not on it.`,
    );
    expect(code).toBe(1);
  });

  it("fails when it cannot decide", async () => {
    const { PR_NUMBER: _left, ...rest } = variables("http://127.0.0.1:9");
    const { code, output } = await script(rest);
    expect(output).toContain(
      `::error title=${LABEL}::The check could not decide: PR_NUMBER is not set`,
    );
    expect(code).toBe(1);
  });

  it("imports nothing", () => {
    const source = read("scripts/laws-approval.ts");
    const scanned = new Bun.Transpiler({ loader: "ts" }).scan(source);
    expect(scanned.imports).toEqual([]);
    expect(source).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
  });
});

const runOf = (step: Payload | undefined): string => {
  const found = step?.["run"];
  return typeof found === "string" ? found : "";
};
const usesOf = (step: Payload): string => (typeof step["uses"] === "string" ? step["uses"] : "");
const steps = (job: Payload): Payload[] => {
  const found: unknown = job["steps"];
  if (!Array.isArray(found)) {
    throw new Error("the job has no steps");
  }
  return found.map((step: unknown, index) => payload(step, `step ${index + 1}`));
};

describe("the laws-approval workflow", () => {
  const FILE = ".github/workflows/laws-approval.yml";
  const workflow = payload(Bun.YAML.parse(read(FILE)), FILE);
  const jobs = payload(workflow["jobs"], "jobs");
  const job = payload(jobs["laws-approval"], "the laws-approval job");
  const all = steps(job);
  const index = (match: (step: Payload) => boolean): number => all.findIndex(match);
  const SETUP_BUN = index((step) => usesOf(step).startsWith("oven-sh/setup-bun@"));
  const NO_NODE = index((step) => step["name"] === "Make every call to node fail");
  const CHECK = index((step) => step["name"] === "Check the owner's approval");

  it("runs on pull_request for six events, with no filter", () => {
    const triggers = payload(workflow["on"], "on");
    expect(Object.keys(triggers)).toEqual(["pull_request"]);
    const pull = payload(triggers["pull_request"], "pull_request");
    expect(Object.keys(pull)).toEqual(["types"]);
    expect(pull["types"]).toEqual([
      "opened",
      "reopened",
      "synchronize",
      "edited",
      "labeled",
      "unlabeled",
    ]);
  });

  it("is read-only by default, and its job reads the pull request, its timeline and the runs", () => {
    expect(workflow["permissions"]).toEqual({ contents: "read" });
    expect(job["permissions"]).toEqual({
      contents: "read",
      "pull-requests": "read",
      actions: "read",
    });
  });

  it("reports one check, named laws-approval, on every pull request", () => {
    expect(Object.keys(jobs)).toEqual(["laws-approval"]);
    for (const key of ["name", "if", "strategy", "uses", "needs", "continue-on-error"]) {
      expect(job).not.toHaveProperty(key);
    }
    expect(all.filter((step) => "if" in step || "continue-on-error" in step)).toEqual([]);
  });

  it("follows the concurrency rule of ci.yml", () => {
    const ci = payload(Bun.YAML.parse(read(".github/workflows/ci.yml")), "ci.yml");
    expect(workflow["concurrency"]).toEqual(ci["concurrency"]);
    expect(job["timeout-minutes"]).toBe(20);
  });

  it("checks out the pull request without keeping the token", () => {
    expect(all[0]).toEqual({
      uses: expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/) as unknown,
      with: { "persist-credentials": false },
    });
  });

  it("sets up its own pinned Bun after the step that makes every call to node fail", () => {
    const { packageManager } = payload(JSON.parse(read("package.json")), "package.json");
    const version = typeof packageManager === "string" ? packageManager.replace(/^bun@/, "") : "";
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(all[SETUP_BUN]).toEqual({
      name: "Install Bun",
      uses: expect.stringMatching(/^oven-sh\/setup-bun@[0-9a-f]{40}$/) as unknown,
      with: { "bun-version": version, "no-cache": true },
    });
    expect(NO_NODE).toBeGreaterThan(0);
    expect(NO_NODE).toBeLessThan(SETUP_BUN);
    expect(SETUP_BUN).toBeLessThan(CHECK);
    expect(all.filter((step) => usesOf(step).startsWith("./"))).toEqual([]);
  });

  it("puts a node that fails on PATH, from outside the checkout", () => {
    const shim = runOf(all[NO_NODE]);
    expect(shim).not.toBe("");
    const temp = mkdtempSync(join(tmpdir(), "laws-approval-"));
    try {
      const path = join(temp, "github-path");
      const ran = Bun.spawnSync(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", shim], {
        env: {
          PATH: process.env["PATH"] ?? "",
          RUNNER_TEMP: temp,
          GITHUB_PATH: path,
          GITHUB_WORKSPACE: root,
        },
      });
      expect(ran.exitCode).toBe(0);
      const added = readFileSync(path, "utf8").trim().split("\n");
      expect(added).toEqual([join(temp, "no-node")]);
      const node = Bun.spawnSync([join(temp, "no-node", "node"), "--version"]);
      expect(node.exitCode).toBe(1);
      expect(node.stderr.toString()).toContain(
        "::error title=node called::Davloom runs on Bun only, but a step called: node --version",
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("runs the script with --no-env-file and no install", () => {
    expect(all[CHECK]).toEqual({
      name: "Check the owner's approval",
      env: {
        GITHUB_TOKEN: "${{ github.token }}",
        PR_NUMBER: "${{ github.event.pull_request.number }}",
        HEAD_SHA: "${{ github.event.pull_request.head.sha }}",
        OWNER_ID: "${{ github.repository_owner_id }}",
      },
      run: "bun --no-env-file scripts/laws-approval.ts",
    });
    expect(CHECK).toBe(all.length - 1);
    const runs = all.map((step) => runOf(step));
    expect(runs.filter((text) => /\bbun (?:install|i|add)\b/.test(text))).toEqual([]);
  });

  it("guards itself and the script it runs, which exist", () => {
    expect(GUARDED).toEqual(
      expect.arrayContaining([FILE, "scripts/laws-approval.ts", "bunfig.toml"]),
    );
    for (const path of [FILE, "scripts/laws-approval.ts"]) {
      expect(() => read(path)).not.toThrow();
    }
  });

  // The Ruleset matches a required check by its name and the app that reports it, and every
  // workflow reports as GitHub Actions, so a job of this name elsewhere could report the check.
  // The test sees only literal names, so it refuses a name that an expression sets, such as
  // ${{ 'laws-approval' }}.
  it("is the one workflow with a job that reports laws-approval", () => {
    const others = [
      ...new Bun.Glob(".github/workflows/*.{yml,yaml}").scanSync({ cwd: root, dot: true }),
    ]
      .filter((file) => file !== FILE)
      .toSorted();
    expect(others.length).toBeGreaterThan(0);
    for (const file of others) {
      const other = payload(payload(Bun.YAML.parse(read(file)), file)["jobs"], `${file} jobs`);
      const names = Object.entries(other).map(([id, value]) => {
        const name = payload(value, id)["name"];
        return typeof name === "string" ? name : id;
      });
      expect(names, file).not.toContain("laws-approval");
      expect(
        names.filter((name) => name.includes("${{")),
        file,
      ).toEqual([]);
    }
  });
});

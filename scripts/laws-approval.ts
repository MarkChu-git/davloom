// The laws-approval check (Decision 11 of add-phase-1-core). A pull request that changes a guarded
// file fails it until the owner adds the laws-approved label after the pull request's head became
// its head, as GitHub's records show. Every run decides afresh from those records, so a run that
// GitHub cancels or drops changes nothing.
//
// .github/workflows/laws-approval.yml runs this file with `bun --no-env-file` and no install, so
// it imports nothing: no package, no other file of the repository and no module that a path
// mapping could redirect. What the check does then depends only on the guarded files.

/** The files whose change needs the owner's label. The LAWS.bend of a test fixture is not one. */
export const GUARDED: readonly string[] = [
  "packages/laws/LAWS.bend",
  ".github/workflows/laws-approval.yml",
  "scripts/laws-approval.ts",
  // Bun reads the root bunfig.toml before it runs this file, and its preload would run first.
  "bunfig.toml",
];

/** The label that only the owner adds (PRD §4). */
export const LABEL = "laws-approved";

// The timeline events after which the head counts as new, even when its commit was the head
// before: a force-push can bring an older head back, a restored branch can hold any commit, and
// reopening a pull request drops its approval.
const RESETS: readonly string[] = ["head_ref_force_pushed", "head_ref_restored", "reopened"];

/** The records the check reads, as GitHub's REST API returns them. */
export interface Records {
  /** GET /repos/{repository}/pulls/{number}. */
  pullRequest: unknown;
  /** Every page of GET /repos/{repository}/pulls/{number}/files, which lists at most 3,000. */
  files: unknown[];
  /** Every page of GET /repos/{repository}/issues/{number}/timeline. */
  timeline: unknown[];
  /** The `workflow_runs` of every page of this workflow's runs for the head branch. */
  runs: unknown[];
  /**
   * Every page of GET /repos/{repository}/pulls?state=all&head={owner}:{branch}: the pull requests
   * in every state from the head branch of the head repository, whose owner's login is {owner}.
   * Empty when the head repository no longer exists.
   */
  fromHead: unknown[];
}

export interface Context {
  /** The head that the run checks, from the event that started it. */
  headSha: string;
  /** The account ID of the repository's owner. */
  ownerId: number;
}

export interface Verdict {
  pass: boolean;
  message: string;
}

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Each reader throws on a record of another shape, so the check fails instead of guessing.
const field = (value: unknown, key: string, what: string): unknown => {
  if (!isFields(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value[key];
};

const text = (value: unknown, key: string, what: string): string => {
  const found = field(value, key, what);
  if (typeof found !== "string") {
    throw new Error(`${what} has no ${key}`);
  }
  return found;
};

// A string, or undefined for a field that GitHub leaves out or sets to null.
const optionalText = (value: unknown, key: string, what: string): string | undefined => {
  const found = field(value, key, what);
  if (found === undefined || found === null) {
    return undefined;
  }
  if (typeof found !== "string") {
    throw new Error(`${what} has a ${key} that is not a string`);
  }
  return found;
};

const whole = (value: unknown, key: string, what: string): number => {
  const found = field(value, key, what);
  if (typeof found !== "number" || !Number.isSafeInteger(found) || found < 0) {
    throw new Error(`${what} has no ${key}`);
  }
  return found;
};

const items = (value: unknown, key: string, what: string): unknown[] => {
  const found = field(value, key, what);
  if (!Array.isArray(found)) {
    throw new Error(`${what} has no ${key} list`);
  }
  return found;
};

// GitHub's times, such as 2026-11-20T08:16:54Z, in milliseconds. They have a resolution of a
// second.
const moment = (value: unknown, key: string, what: string): number => {
  const found = Date.parse(text(value, key, what));
  if (Number.isNaN(found)) {
    throw new Error(`${what} has a ${key} that is not a time`);
  }
  return found;
};

const iso = (time: number): string => new Date(time).toISOString().replace(".000Z", "Z");

const listed = (parts: string[]): string =>
  new Intl.ListFormat("en-GB", { type: "conjunction" }).format(parts);

// The guarded files that the pull request changes, under their new name or their old one, and the
// files that GitHub leaves out of its list, which may be guarded too.
const changes = (files: unknown[], changedFiles: number): string[] => {
  const names = new Set<string>();
  for (const [index, file] of files.entries()) {
    const what = `changed file ${index + 1}`;
    names.add(text(file, "filename", what));
    const previous = optionalText(file, "previous_filename", what);
    if (previous !== undefined) {
      names.add(previous);
    }
  }
  const found = GUARDED.filter((path) => names.has(path));
  const unlisted = changedFiles - files.length;
  if (unlisted > 0) {
    found.push(`${unlisted} ${unlisted === 1 ? "file" : "files"} that GitHub does not list`);
  }
  return found;
};

interface Mark {
  event: string;
  at: number;
  position: number;
  actorId: number | undefined;
  actor: string;
}

// The timeline's resets, and its labeled and unlabeled events for the label. GitHub records no
// time for some other events, such as committed, which the check does not read.
const marks = (timeline: unknown[]): Mark[] =>
  timeline.flatMap((item, position) => {
    const what = `timeline event ${position + 1}`;
    const event = text(item, "event", what);
    const forLabel =
      (event === "labeled" || event === "unlabeled") &&
      text(field(item, "label", what), "name", `the label of ${what}`) === LABEL;
    if (!forLabel && !RESETS.includes(event)) {
      return [];
    }
    const actor = field(item, "actor", what);
    return [
      {
        event,
        at: moment(item, "created_at", what),
        position,
        actorId: isFields(actor) && typeof actor["id"] === "number" ? actor["id"] : undefined,
        actor:
          isFields(actor) && typeof actor["login"] === "string"
            ? actor["login"]
            : "an account that GitHub does not name",
      },
    ];
  });

// The latest mark, by time and then by its place in the timeline, which runs oldest first.
const latest = (found: Mark[]): Mark | undefined => {
  let best: Mark | undefined;
  for (const mark of found) {
    if (
      best === undefined ||
      mark.at > best.at ||
      (mark.at === best.at && mark.position > best.position)
    ) {
      best = mark;
    }
  }
  return best;
};

interface Run {
  sha: string;
  at: number;
}

// The runs of the pull request's head branch: pull_request runs from its head repository. A
// fork's branch with the same name is another branch.
const runsOf = (runs: unknown[], branch: string, repository: string): Run[] =>
  runs.flatMap((run, index) => {
    const what = `run ${index + 1}`;
    const repo = field(run, "head_repository", what);
    const ours =
      text(run, "event", what) === "pull_request" &&
      optionalText(run, "head_branch", what) === branch &&
      isFields(repo) &&
      text(repo, "full_name", `the head repository of ${what}`) === repository;
    return ours ? [{ sha: text(run, "head_sha", what), at: moment(run, "created_at", what) }] : [];
  });

/**
 * Decides the check from GitHub's records. A pull request that changes no guarded file passes.
 * One that does passes only when no other pull request came from its head branch, the label is on
 * it, the latest event that added the label came from the owner, and that event came strictly
 * after the head became the head: the creation of the first run of this workflow for the head
 * that comes strictly after both the latest run for another head and the latest reset. Throws on
 * a record of another shape.
 */
export const decide = (records: Records, context: Context): Verdict => {
  const pull = records.pullRequest;
  const head = field(pull, "head", "the pull request");
  const sha = text(head, "sha", "the head");
  const changed = changes(records.files, whole(pull, "changed_files", "the pull request"));
  if (changed.length === 0) {
    return {
      pass: true,
      message: "The pull request changes no guarded file, so it needs no label.",
    };
  }
  const needs = `The pull request changes ${listed(changed)}, so it needs the owner's ${LABEL} label, added after its last commit.`;
  const fail = (why: string): Verdict => ({ pass: false, message: `${needs} ${why}` });

  if (sha !== context.headSha) {
    return fail(
      `Its head is ${sha} now, not ${context.headSha}, which this run checks; the run for the new head decides.`,
    );
  }
  const repo = field(head, "repo", "the head");
  if (!isFields(repo)) {
    return fail(
      "Its head repository no longer exists, so its runs cannot be told from those of other branches.",
    );
  }
  const branch = text(head, "ref", "the head");
  const repository = text(repo, "full_name", "the head repository");
  // The runs of a fork's pull request name no pull request, so the runs of the head branch show
  // when this pull request's head became its head only when no other pull request ever came from
  // that branch.
  const number = whole(pull, "number", "the pull request");
  const fromHead = new Set(
    records.fromHead.map((item, index) =>
      whole(item, "number", `pull request ${index + 1} from the head`),
    ),
  );
  const others = [...fromHead].filter((other) => other !== number);
  if (others.length > 0) {
    return fail(
      `${others.length === 1 ? "Pull request" : "Pull requests"} ${listed(others.map((other) => `#${other}`))} also came from the branch ${branch} of ${repository}, and this workflow's runs do not show which pull request they ran for. Open the pull request again from a new branch, and close this one.`,
    );
  }
  if (!fromHead.has(number)) {
    return fail(
      `GitHub does not list it among the pull requests from the branch ${branch} of ${repository}, so the check cannot tell whether another one came from there.`,
    );
  }
  const labels = items(pull, "labels", "the pull request").map((label, index) =>
    text(label, "name", `label ${index + 1}`),
  );
  if (!labels.includes(LABEL)) {
    return fail("The label is not on it.");
  }
  const timeline = marks(records.timeline);
  const label = latest(
    timeline.filter((mark) => mark.event === "labeled" || mark.event === "unlabeled"),
  );
  if (label === undefined) {
    return fail("Its timeline holds no event that added the label.");
  }
  if (label.event === "unlabeled") {
    return fail(
      `Its timeline shows the label removed at ${iso(label.at)}, after it was last added.`,
    );
  }
  if (label.actorId !== context.ownerId) {
    return fail(`${label.actor} added the label, not the owner.`);
  }
  const runs = runsOf(records.runs, branch, repository);
  const after = Math.max(
    -Infinity,
    ...timeline.filter((mark) => RESETS.includes(mark.event)).map((mark) => mark.at),
    ...runs.filter((run) => run.sha !== sha).map((run) => run.at),
  );
  const start = Math.min(
    Infinity,
    ...runs.filter((run) => run.sha === sha && run.at > after).map((run) => run.at),
  );
  if (start === Infinity) {
    return fail(
      after === -Infinity
        ? `GitHub lists no run of this workflow for ${sha}, so its records do not show when it became the head.`
        : `No run of this workflow for ${sha} comes after ${iso(after)}, the latest force-push, restored branch, reopening or run for another head, so GitHub's records do not show when it became the head.`,
    );
  }
  if (label.at <= start) {
    return fail(
      `The owner added the label at ${iso(label.at)}, which is not after ${iso(start)}, when ${sha} became the head.`,
    );
  }
  return {
    pass: true,
    message: `The pull request changes ${listed(changed)}, and the owner added ${LABEL} at ${iso(label.at)}, after ${sha} became the head at ${iso(start)}.`,
  };
};

/** What the check reads from the variables that the workflow and GitHub Actions set. */
export interface Settings extends Context {
  /** GITHUB_API_URL, such as https://api.github.com. */
  api: string;
  /** GITHUB_REPOSITORY, as owner/name. */
  repository: string;
  /** GITHUB_TOKEN, the run's read-only token. */
  token: string;
  /** PR_NUMBER. */
  number: number;
  /** GITHUB_RUN_ID, which leads to this workflow. */
  runId: number;
}

/** Reads the settings, and throws on a variable that is missing or malformed. */
export const settings = (variables: Record<string, string | undefined>): Settings => {
  const read = (name: string, pattern: RegExp): string => {
    const value = variables[name];
    if (value === undefined || value === "") {
      throw new Error(`${name} is not set`);
    }
    // The value stays out of the message, which a token would otherwise reach.
    if (!pattern.test(value)) {
      throw new Error(`${name} is malformed`);
    }
    return value;
  };
  const id = /^[1-9]\d{0,15}$/;
  return {
    api: read("GITHUB_API_URL", /^https?:\/\/\S+$/),
    repository: read("GITHUB_REPOSITORY", /^[\w.-]+\/[\w.-]+$/),
    token: read("GITHUB_TOKEN", /^\S+$/),
    number: Number(read("PR_NUMBER", id)),
    runId: Number(read("GITHUB_RUN_ID", id)),
    headSha: read("HEAD_SHA", /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
    ownerId: Number(read("OWNER_ID", id)),
  };
};

const PAGE = 100;
const ATTEMPTS = 3;
// GitHub lists at most 3,000 changed files, and at most 1,000 runs for a filtered list. The
// timeline and the list of the pull requests from a head have no such limit, so the check reads up
// to 10,000 events of the timeline and up to 1,000 of those pull requests.
const FILE_PAGES = 30;
const TIMELINE_PAGES = 100;
const RUN_PAGES = 10;
const PULL_PAGES = 10;

/**
 * Reads the pull request's records from GitHub's REST API and decides. A request that fails or
 * that a server error ends is tried again, up to three times, `retryMs` apart and then twice that;
 * any other answer that is not a success stops the check. Throws when a list is longer than the
 * check reads, except for the changed files, which `decide` treats as guarded.
 */
export const check = async (options: Settings, retryMs = 1000): Promise<Verdict> => {
  const base = options.api.endsWith("/") ? options.api : `${options.api}/`;

  const get = async (path: string, query: Record<string, string>): Promise<unknown> => {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const name = `GET ${url.pathname}${url.search}`;
    for (let attempt = 1; ; attempt += 1) {
      let response: Response | undefined;
      let error: unknown;
      try {
        response = await fetch(url, {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${options.token}`,
            "user-agent": "davloom-laws-approval",
            "x-github-api-version": "2022-11-28",
          },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (caught) {
        error = caught;
      }
      if (response?.ok === true) {
        return await response.json();
      }
      const failure =
        response === undefined
          ? `failed: ${error instanceof Error ? error.message : String(error)}`
          : `answered ${response.status}: ${(await response.text()).slice(0, 300)}`;
      if ((response !== undefined && response.status < 500) || attempt === ATTEMPTS) {
        throw new Error(`${name} ${failure}`, { cause: error });
      }
      await Bun.sleep(retryMs * attempt);
    }
  };

  // Every entry of a paged list, up to `limit` pages of 100. `complete` refuses a longer list.
  const pages = async (
    path: string,
    query: Record<string, string>,
    limit: number,
    complete: boolean,
    entries: (body: unknown) => unknown = (body) => body,
  ): Promise<unknown[]> => {
    const all: unknown[] = [];
    for (let page = 1; page <= limit; page += 1) {
      const body = await get(path, { ...query, per_page: String(PAGE), page: String(page) });
      const found = entries(body);
      if (!Array.isArray(found)) {
        throw new Error(`page ${page} of ${path} is not a list`);
      }
      all.push(...(found as unknown[]));
      if (found.length < PAGE) {
        return all;
      }
    }
    if (complete) {
      throw new Error(
        `${path} lists more than ${limit * PAGE} entries, which the check does not read`,
      );
    }
    return all;
  };

  const repository = `repos/${options.repository}`;
  const pull = `${repository}/pulls/${options.number}`;
  const pullRequest = await get(pull, {});
  const files = await pages(`${pull}/files`, {}, FILE_PAGES, false);
  const timeline = await pages(
    `${repository}/issues/${options.number}/timeline`,
    {},
    TIMELINE_PAGES,
    true,
  );
  // The run names its workflow, which the runs below are listed for.
  const workflow = whole(
    await get(`${repository}/actions/runs/${options.runId}`, {}),
    "workflow_id",
    "this run",
  );
  const head = field(pullRequest, "head", "the pull request");
  const branch = text(head, "ref", "the head");
  const runs = await pages(
    `${repository}/actions/workflows/${workflow}/runs`,
    { branch, event: "pull_request" },
    RUN_PAGES,
    true,
    (body) => field(body, "workflow_runs", "a page of runs"),
  );
  // GitHub names a head by the login of its repository's owner. A head repository that no longer
  // exists names none, and decide fails on it.
  const repo = field(head, "repo", "the head");
  const fromHead = isFields(repo)
    ? await pages(
        `${repository}/pulls`,
        {
          state: "all",
          head: `${text(field(repo, "owner", "the head repository"), "login", "the owner of the head repository")}:${branch}`,
        },
        PULL_PAGES,
        true,
      )
    : [];
  return decide({ pullRequest, files, timeline, runs, fromHead }, options);
};

// A workflow command, which GitHub shows as an error on the run and on the pull request.
const annotation = (message: string): string =>
  `::error title=${LABEL}::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;

if (import.meta.main) {
  try {
    const verdict = await check(settings(process.env));
    console.log(verdict.pass ? verdict.message : annotation(verdict.message));
    process.exitCode = verdict.pass ? 0 : 1;
  } catch (error) {
    console.error(error);
    console.log(
      annotation(
        `The check could not decide: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    process.exitCode = 1;
  }
}

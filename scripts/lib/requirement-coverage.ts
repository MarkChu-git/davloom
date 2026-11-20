import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The requirement coverage check (Decision 12 of add-phase-1-core). Every scenario in openspec/specs
// needs a test that carries its name, which is its ID, or an entry in tests/verified-elsewhere.yaml
// that says where and how it was verified. No two scenarios may share a name, and every entry has
// to name a scenario that exists.

export interface Scenario {
  /** The spec's path from the repository root, such as openspec/specs/webdav-transport/spec.md. */
  readonly spec: string;
  readonly name: string;
}

/** Where an entry of tests/verified-elsewhere.yaml says its scenario was verified. */
export const PLACES = ["on a real deployment", "on GitHub", "by hand"] as const;
export type Place = (typeof PLACES)[number];

export interface Verified {
  readonly scenario: string;
  readonly verified: Place;
  readonly how: string;
}

export const LIST = "tests/verified-elsewhere.yaml";

const isFields = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const items = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${what} is not a list`);
  }
  return value;
};

const text = (value: unknown, key: string, what: string): string => {
  const found = isFields(value) ? value[key] : undefined;
  if (typeof found !== "string" || found.trim() === "") {
    throw new Error(`${what} has no ${key}`);
  }
  return found;
};

const listed = (parts: readonly string[]): string =>
  new Intl.ListFormat("en-GB", { type: "conjunction" }).format(parts);

const disjunction = (parts: readonly string[]): string =>
  new Intl.ListFormat("en-GB", { type: "disjunction" }).format(parts);

// A spec is read as the parser of OpenSpec 1.14.3 reads it (MarkdownParser.parseSpec), so the
// check counts the scenarios that `openspec validate` counts. Headings outside fenced code make a
// tree of sections. Each child of the "Requirements" section is a requirement, and each child of a
// requirement whose body is not empty is a scenario, named by its heading without "Scenario:".

interface Section {
  readonly level: number;
  readonly title: string;
  readonly body: string;
  readonly children: Section[];
}

const HEADING = /^(#{1,6})\s+(.+)$/;
const OPENING_FENCE = /^\s*(`{3,}|~{3,})/;
const CLOSING_FENCE = /^\s*(`{3,}|~{3,})\s*$/;

// Whether each line belongs to fenced code, its fences included. A fence closes with a run of the
// same character at least as long as the one that opened it, alone on its line.
const fenced = (lines: readonly string[]): boolean[] => {
  let open: string | undefined;
  return lines.map((line) => {
    if (open === undefined) {
      open = OPENING_FENCE.exec(line)?.[1];
      return open !== undefined;
    }
    const close = CLOSING_FENCE.exec(line)?.[1];
    if (close !== undefined && close[0] === open[0] && close.length >= open.length) {
      open = undefined;
    }
    return true;
  });
};

const sections = (markdown: string): Section[] => {
  const lines = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const code = fenced(lines);
  const headings = lines.flatMap((line, index) => {
    const match = code[index] === true ? null : HEADING.exec(line);
    return match === null
      ? []
      : [{ index, level: match[1]?.length ?? 0, title: (match[2] ?? "").trim() }];
  });
  const roots: Section[] = [];
  const open: Section[] = [];
  for (const [at, { index, level, title }] of headings.entries()) {
    // A section's body runs to the next heading at its level or above.
    const end = headings.slice(at + 1).find((next) => next.level <= level)?.index ?? lines.length;
    const section = {
      level,
      title,
      body: lines
        .slice(index + 1, end)
        .join("\n")
        .trim(),
      children: [],
    };
    while ((open.at(-1)?.level ?? 0) >= level) {
      open.pop();
    }
    (open.at(-1)?.children ?? roots).push(section);
    open.push(section);
  }
  return roots;
};

// The first section with the title, in the order of the spec, at any depth.
const find = (within: readonly Section[], title: string): Section | undefined => {
  for (const section of within) {
    const found =
      section.title.toLowerCase() === title.toLowerCase() ? section : find(section.children, title);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

/** The scenarios of one spec, in its order. Throws when the spec has no Requirements section. */
export const scenariosIn = (spec: string, markdown: string): Scenario[] => {
  const requirements = find(sections(markdown), "Requirements");
  if (requirements === undefined) {
    throw new Error(`${spec} has no Requirements section`);
  }
  return requirements.children.flatMap((requirement) =>
    requirement.children
      .filter(({ body }) => body !== "")
      .map(({ title }) => ({
        spec,
        // An optional closing run of `#` goes, as CommonMark has it, and so does "Scenario:".
        name: title
          .replace(/[ \t]+#+[ \t]*$/, "")
          .replace(/^Scenario:\s*/i, "")
          .trim(),
      })),
  );
};

// Vitest names a test by the names of the blocks around it and its own, joined with " > ", so a
// test's own name is what follows the last one. A test whose own name holds " > " reads as shorter.
export const ownName = (fullName: string): string => {
  const at = fullName.lastIndexOf(" > ");
  return at === -1 ? fullName : fullName.slice(at + " > ".length);
};

/** The own names of the tests in what `vitest list --json` writes: a list of `{ name, file }`. */
export const vitestNames = (listing: unknown): string[] =>
  items(listing, "the Vitest listing").map((test, index) =>
    ownName(text(test, "name", `test ${index + 1} of the Vitest listing`)),
  );

/**
 * The own names of the tests in Playwright's JSON report of `playwright test --list`, where each
 * spec has its own title and sits in suites for its file and its describe blocks. Throws when the
 * report holds an error, such as a spec file that failed to load.
 */
export const playwrightNames = (report: unknown): string[] => {
  const errors = isFields(report) ? report["errors"] : undefined;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(`Playwright could not list its tests: ${JSON.stringify(errors[0])}`);
  }
  const names: string[] = [];
  const walk = (suite: unknown, what: string): void => {
    const specs = isFields(suite) ? suite["specs"] : undefined;
    for (const [index, spec] of items(specs ?? [], `the specs of ${what}`).entries()) {
      names.push(text(spec, "title", `spec ${index + 1} of ${what}`));
    }
    const suites = isFields(suite) ? suite["suites"] : undefined;
    for (const [index, child] of items(suites ?? [], `the suites of ${what}`).entries()) {
      walk(child, `suite ${index + 1} of ${what}`);
    }
  };
  if (!isFields(report) || !Array.isArray(report["suites"])) {
    throw new Error("the Playwright report has no suites");
  }
  walk(report, "the Playwright report");
  return names;
};

/** The entries of tests/verified-elsewhere.yaml as Bun.YAML parses it, which is null when empty. */
export const verifiedEntries = (parsed: unknown): Verified[] => {
  if (parsed === null || parsed === undefined) {
    return [];
  }
  return items(parsed, LIST).map((entry, index) => {
    const what = `entry ${index + 1} of ${LIST}`;
    const extra = isFields(entry)
      ? Object.keys(entry).filter((key) => !["scenario", "verified", "how"].includes(key))
      : [];
    if (extra.length > 0) {
      throw new Error(`${what} has a key it should not have: ${listed(extra)}`);
    }
    const verified = text(entry, "verified", what);
    const place = PLACES.find((candidate) => candidate === verified);
    if (place === undefined) {
      throw new Error(
        `${what} says "${verified}", not ${disjunction(PLACES.map((p) => `"${p}"`))}`,
      );
    }
    return {
      scenario: text(entry, "scenario", what),
      verified: place,
      how: text(entry, "how", what),
    };
  });
};

// The scenario names that a test's own name carries: the name itself, and each part before a `:`
// that more text follows, as in `Replacing a file: R2`.
const carried = (test: string): string[] => [
  test,
  ...[...test.matchAll(/:/g)]
    .map((match) => match.index)
    .filter((index) => index > 0 && index < test.length - 1)
    .map((index) => test.slice(0, index)),
];

/** Whether a test whose own name is `test` covers the scenario named `scenario`. */
export const carries = (test: string, scenario: string): boolean =>
  carried(test).includes(scenario);

export interface Report {
  /** What fails the check, one sentence each. */
  readonly failures: readonly string[];
  /** The scenarios without a test that pass through an entry of the list. */
  readonly elsewhere: readonly Verified[];
  /** The scenarios with a test that carries their name. */
  readonly tested: number;
  readonly scenarios: number;
}

/** Checks every scenario against the tests' own names and the entries of the list. */
export const coverage = (
  scenarios: readonly Scenario[],
  tests: readonly string[],
  entries: readonly Verified[],
): Report => {
  const failures: string[] = [];
  const byName = new Map<string, Scenario[]>();
  for (const scenario of scenarios) {
    byName.set(scenario.name, [...(byName.get(scenario.name) ?? []), scenario]);
  }
  for (const [name, found] of byName) {
    if (found.length > 1) {
      failures.push(
        `${found.length} scenarios share the name "${name}", in ${listed(found.map(({ spec }) => spec))}.`,
      );
    }
  }

  const listedFor = new Map<string, Verified[]>();
  for (const entry of entries) {
    listedFor.set(entry.scenario, [...(listedFor.get(entry.scenario) ?? []), entry]);
  }
  for (const [name, found] of listedFor) {
    if (!byName.has(name)) {
      failures.push(`${LIST} lists "${name}", which no scenario in openspec/specs has.`);
    } else if (found.length > 1) {
      failures.push(`${LIST} lists "${name}" ${found.length} times.`);
    }
  }

  const names = new Set(tests.flatMap(carried));
  const elsewhere: Verified[] = [];
  let tested = 0;
  for (const scenario of scenarios) {
    const entry = listedFor.get(scenario.name)?.[0];
    if (names.has(scenario.name)) {
      tested += 1;
    } else if (entry !== undefined) {
      elsewhere.push(entry);
    } else {
      failures.push(
        `${scenario.spec}: "${scenario.name}" has no test that carries its name, and no entry in ${LIST}.`,
      );
    }
  }
  return { failures, elsewhere, tested, scenarios: scenarios.length };
};

/** The report as the check prints it. */
export const formatReport = (report: Report): string => {
  const lines = [
    `${report.scenarios} ${report.scenarios === 1 ? "scenario" : "scenarios"}: ${report.tested} with a test that carries their name, ${report.elsewhere.length} verified elsewhere.`,
    ...report.elsewhere.map(
      ({ scenario, verified, how }) => `"${scenario}" is verified ${verified}: ${how}`,
    ),
  ];
  if (report.failures.length > 0) {
    lines.push(
      "",
      "Requirement coverage fails:",
      ...report.failures.map((failure) => `- ${failure}`),
    );
  }
  return lines.join("\n");
};

// The directories whose Vitest and Playwright configurations hold tests: the root and each
// workspace that the root package.json names. A repository without a package.json has the root only.
const workspaces = (root: string): string[] => {
  const file = join(root, "package.json");
  const manifest: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const patterns =
    isFields(manifest) && Array.isArray(manifest["workspaces"]) ? manifest["workspaces"] : [];
  const found = patterns
    .filter((pattern): pattern is string => typeof pattern === "string")
    .flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: false })])
    .filter((path) => statSync(join(root, path)).isDirectory());
  return [".", ...found.toSorted()];
};

const CONFIG = /^(vitest|playwright)(\.[\w-]+)*\.config\.[cm]?[jt]s$/;

/** The Vitest and Playwright configurations at the root and in each workspace, by their paths. */
export const configurations = (root: string): { vitest: string[]; playwright: string[] } => {
  const vitest: string[] = [];
  const playwright: string[] = [];
  for (const workspace of workspaces(root)) {
    for (const file of readdirSync(join(root, workspace)).toSorted()) {
      const kind = CONFIG.exec(file)?.[1];
      const path = workspace === "." ? file : join(workspace, file);
      if (kind === "vitest") {
        vitest.push(path);
      } else if (kind === "playwright") {
        playwright.push(path);
      }
    }
  }
  return { vitest, playwright };
};

// Runs the listing that `what` names in `cwd` and returns the JSON it wrote to `output`.
// DAVLOOM_LIST_TESTS keeps the contract suites from starting containers while their tests are listed.
const listing = (
  what: string,
  command: string[],
  cwd: string,
  output: string,
  extra: Record<string, string> = {},
): unknown => {
  const run = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...extra, DAVLOOM_LIST_TESTS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (run.exitCode !== 0) {
    const said = `${run.stdout.toString()}${run.stderr.toString()}`.trim().split("\n").slice(-20);
    throw new Error(`${what} failed with exit code ${run.exitCode}:\n${said.join("\n")}`);
  }
  return JSON.parse(readFileSync(output, "utf8"));
};

/**
 * The own names of every test in the configurations, collected without running the tests. Vitest
 * runs each test file to collect its tests: `vitest list` parses the files by default, which misses
 * the tests that a shared suite defines and leaves the names of `each` tests unexpanded.
 */
export const listTests = (root: string): string[] => {
  const { vitest, playwright } = configurations(root);
  const scratch = mkdtempSync(join(tmpdir(), "requirement-coverage-"));
  try {
    const names: string[] = [];
    for (const [index, config] of vitest.entries()) {
      const cwd = join(root, dirname(config));
      const cli = join(dirname(Bun.resolveSync("vitest/package.json", cwd)), "vitest.mjs");
      const output = join(scratch, `vitest-${index}.json`);
      const command = [
        process.execPath,
        "--bun",
        cli,
        "list",
        "--config",
        join(root, config),
        "--no-staticParse",
        `--json=${output}`,
      ];
      names.push(...vitestNames(listing(`vitest list --config ${config}`, command, cwd, output)));
    }
    for (const [index, config] of playwright.entries()) {
      const cwd = join(root, dirname(config));
      const cli = join(dirname(Bun.resolveSync("@playwright/test/package.json", cwd)), "cli.js");
      const output = join(scratch, `playwright-${index}.json`);
      const command = [
        process.execPath,
        "--bun",
        cli,
        "test",
        "--list",
        "--reporter=json",
        "--config",
        join(root, config),
      ];
      const report = listing(`playwright test --list --config ${config}`, command, cwd, output, {
        PLAYWRIGHT_JSON_OUTPUT_NAME: output,
      });
      names.push(...playwrightNames(report));
    }
    return names;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

/** The scenarios of every spec under openspec/specs. */
export const readScenarios = (root: string): Scenario[] =>
  [...new Bun.Glob("openspec/specs/**/spec.md").scanSync({ cwd: root })]
    .toSorted()
    .flatMap((spec) => scenariosIn(spec, readFileSync(join(root, spec), "utf8")));

/** The entries of the list, which has to exist. */
export const readEntries = (root: string): Verified[] =>
  verifiedEntries(Bun.YAML.parse(readFileSync(join(root, LIST), "utf8")));

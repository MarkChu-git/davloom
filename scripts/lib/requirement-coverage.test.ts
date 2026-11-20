import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  carries,
  configurations,
  coverage,
  formatReport,
  ownName,
  playwrightNames,
  type Scenario,
  scenariosIn,
  type Verified,
  verifiedEntries,
  vitestNames,
} from "./requirement-coverage";

const root = fileURLToPath(new URL("../..", import.meta.url));
const fixtures = join(root, "scripts/fixtures/requirement-coverage");
const script = join(root, "scripts/requirement-coverage.ts");

const recorded = (name: string): unknown => JSON.parse(readFileSync(join(fixtures, name), "utf8"));

// Runs the check on a fixture repository, as `bun run check` runs it on this one.
const check = (repository: string) => {
  const run = Bun.spawnSync([process.execPath, script, repository], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
};

const lines = (...text: string[]): string => `${text.join("\n")}\n`;

const byHand = (name: string): Verified => ({ scenario: name, verified: "by hand", how: "So." });

// Each run lists a fixture's tests with Vitest, which takes a few seconds on a busy machine.
const LISTING = 60_000;

describe("the requirement coverage check", () => {
  it(
    "A scenario without a test",
    () => {
      // The fixture's only test is "Replacing a file twice".
      const run = check(join(fixtures, "untested"));
      expect(run.stdout).toBe(
        lines(
          "1 scenario: 0 with a test that carries their name, 0 verified elsewhere.",
          "",
          "Requirement coverage fails:",
          '- openspec/specs/storage/spec.md: "Replacing a file" has no test that carries its name, and no entry in tests/verified-elsewhere.yaml.',
        ),
      );
      expect(run.exitCode).toBe(1);
    },
    LISTING,
  );

  it(
    "A scenario verified by hand",
    () => {
      const run = check(join(fixtures, "passing"));
      expect(run.stdout).toBe(
        lines(
          "4 scenarios: 3 with a test that carries their name, 1 verified elsewhere.",
          '"Mounting by hand" is verified by hand: Mounted with Finder on macOS, which listed the fixture\'s files.',
        ),
      );
      expect(run.stderr).toBe("");
      expect(run.exitCode).toBe(0);
    },
    LISTING,
  );

  it(
    "Two scenarios with one name",
    () => {
      const run = check(join(fixtures, "duplicate"));
      expect(run.stdout).toBe(
        lines(
          "2 scenarios: 2 with a test that carries their name, 0 verified elsewhere.",
          "",
          "Requirement coverage fails:",
          '- 2 scenarios share the name "Listing a collection", in openspec/specs/listing/spec.md and openspec/specs/storage/spec.md.',
        ),
      );
      expect(run.exitCode).toBe(1);
    },
    LISTING,
  );

  it(
    "fails on an entry of the list whose scenario no longer exists",
    () => {
      const run = check(join(fixtures, "stale"));
      expect(run.stdout).toBe(
        lines(
          "1 scenario: 1 with a test that carries their name, 0 verified elsewhere.",
          "",
          "Requirement coverage fails:",
          '- tests/verified-elsewhere.yaml lists "Removing a backend", which no scenario in openspec/specs has.',
        ),
      );
      expect(run.exitCode).toBe(1);
    },
    LISTING,
  );

  it(
    "fails, naming the listing, when a test file does not load",
    () => {
      const run = check(join(fixtures, "broken"));
      expect(run.stdout).toBe("");
      expect(run.stderr).toMatch(
        /^Requirement coverage could not run: vitest list --config vitest\.config\.ts failed with exit code 1:\n/,
      );
      expect(run.stderr).toContain("this fixture fails to load");
      expect(run.exitCode).toBe(1);
    },
    LISTING,
  );

  it.each([
    [
      "a list with an entry of another place",
      "- scenario: Replacing a file\n  verified: in my head\n  how: Thought about it.\n",
      'entry 1 of tests/verified-elsewhere.yaml says "in my head", not "on a real deployment", "on GitHub" or "by hand"',
    ],
    [
      "a list that is not a list",
      "scenario: Replacing a file\n",
      "tests/verified-elsewhere.yaml is not a list",
    ],
  ])("fails on %s before it lists any test", (_what, list, message) => {
    const repository = mkdtempSync(join(tmpdir(), "requirement-coverage-"));
    try {
      mkdirSync(join(repository, "tests"));
      writeFileSync(join(repository, "tests/verified-elsewhere.yaml"), list);
      // A test file that would fail the listing, so the run shows the list is read first.
      writeFileSync(join(repository, "vitest.config.ts"), "throw new Error('listed');\n");
      const run = check(repository);
      expect(run.stderr).toBe(`Requirement coverage could not run: ${message}\n`);
      expect(run.exitCode).toBe(1);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("fails when the list is missing", () => {
    const repository = mkdtempSync(join(tmpdir(), "requirement-coverage-"));
    try {
      const run = check(repository);
      expect(run.stderr).toMatch(/^Requirement coverage could not run: ENOENT/);
      expect(run.stderr).toContain("tests/verified-elsewhere.yaml");
      expect(run.exitCode).toBe(1);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});

describe("scenariosIn", () => {
  const spec = "openspec/specs/storage/spec.md";
  const names = (markdown: string): string[] => scenariosIn(spec, markdown).map(({ name }) => name);
  const body = "- **WHEN** it happens\n- **THEN** it holds";

  it("reads the scenarios of every requirement in their order", () => {
    const markdown = [
      "# storage Specification",
      "## Purpose",
      "#### Scenario: Under the purpose",
      body,
      "## Requirements",
      "### Requirement: Files",
      "The fixture SHALL replace files.",
      "#### Scenario: Replacing a file",
      body,
      "#### Scenario:   Removing a file  ",
      body,
      "### Requirement: Collections",
      "#### scenario: Listing a collection ##",
      body,
      "#### Scenario: Without a body",
      "",
      // A heading below a scenario is part of the scenario's body, not a scenario.
      "#### Creating a collection",
      body,
      "##### Scenario: Inside a scenario",
      body,
      " #### Scenario: Not a heading",
      body,
    ].join("\n");
    expect(names(markdown)).toEqual([
      "Replacing a file",
      "Removing a file",
      "Listing a collection",
      "Creating a collection",
    ]);
  });

  it("reads a spec with CRLF line ends and a byte order mark", () => {
    const markdown =
      "\uFEFF## Requirements\r\n### Requirement: Files\r\n#### Scenario: Replacing a file\r\n- **WHEN** it is\r\n";
    expect(scenariosIn(spec, markdown)).toEqual([{ spec, name: "Replacing a file" }]);
  });

  it("skips headings inside fenced code", () => {
    const markdown = [
      "## Requirements",
      "### Requirement: Files",
      "#### Scenario: Before",
      "```markdown",
      "#### Scenario: In backticks",
      "~~~",
      "#### Scenario: After a tilde line inside backticks",
      "```",
      "#### Scenario: Between",
      "~~~~",
      "#### Scenario: In tildes",
      "~~~ not a closing fence",
      "~~~",
      "#### Scenario: In tildes after a shorter run",
      "~~~~~",
      "    ````",
      "#### Scenario: In four backticks",
      "```",
      "#### Scenario: After a shorter run of backticks",
      "````  ",
      "#### Scenario: After",
      body,
    ].join("\n");
    // Each scenario's body runs to the next heading outside the fences, so "Before" and "Between"
    // hold the fenced lines, and "After" holds the body.
    expect(names(markdown)).toEqual(["Before", "Between", "After"]);
  });

  it("refuses a spec without a Requirements section", () => {
    expect(() => scenariosIn(spec, "## Purpose\nA spec.\n#### Scenario: Alone\n" + body)).toThrow(
      `${spec} has no Requirements section`,
    );
  });
});

describe("the names of listed tests", () => {
  it("takes the own name of a test inside blocks", () => {
    expect(ownName("the storage fixture > collections > Creating a collection")).toBe(
      "Creating a collection",
    );
    expect(ownName("Listing without containers")).toBe("Listing without containers");
  });

  it("reads Vitest's listing", () => {
    // Recorded from `vitest list --no-staticParse --json`, with the paths made relative.
    expect(vitestNames(recorded("vitest-list.json"))).toEqual([
      "Status contrast: in light mode status text and the text on status fills reach 4.5:1",
      "are found",
      ".github/workflows/ci.yml reads no secret other than GITHUB_TOKEN",
      "a correct password starts a session",
    ]);
    expect(vitestNames([{ name: "Listing without containers", file: "cases.spec.ts" }])).toEqual([
      "Listing without containers",
    ]);
  });

  it.each([
    ["a listing that is not a list", { name: "a test" }, "the Vitest listing is not a list"],
    [
      "a test without a name",
      [{ file: "cases.spec.ts" }],
      "test 1 of the Vitest listing has no name",
    ],
  ])("refuses %s from Vitest", (_what, listing, message) => {
    expect(() => vitestNames(listing)).toThrow(message);
  });

  it("reads Playwright's report of its tests, nested suites included", () => {
    // Recorded from `playwright test --list --reporter=json` and cut to one file.
    expect(playwrightNames(recorded("playwright-list.json"))).toEqual([
      "Rendered pages: Overview shows no hue but the status colors in light mode",
      "Rendered pages: Overview with a toast shows no hue but the status colors in light mode",
      "The title line on a touch screen: each page's title stays on the mark's line in the larger type",
    ]);
  });

  it.each([
    [
      "a report with an error",
      { suites: [], errors: [{ message: "cases.spec.ts failed to load" }] },
      'Playwright could not list its tests: {"message":"cases.spec.ts failed to load"}',
    ],
    ["a report without suites", { errors: [] }, "the Playwright report has no suites"],
    [
      "a spec without a title",
      { suites: [{ specs: [{}] }], errors: [] },
      "spec 1 of suite 1 of the Playwright report has no title",
    ],
  ])("refuses %s from Playwright", (_what, report, message) => {
    expect(() => playwrightNames(report)).toThrow(message);
  });
});

describe("the list of scenarios verified elsewhere", () => {
  it("reads an empty list as no entries", () => {
    expect(verifiedEntries(null)).toEqual([]);
    expect(verifiedEntries([])).toEqual([]);
  });

  it("reads each entry", () => {
    expect(
      verifiedEntries([
        { scenario: "Mounting by hand", verified: "by hand", how: "Mounted with Finder." },
        { scenario: "A real bucket", verified: "on a real deployment", how: "Wrote to R2." },
        { scenario: "A required check", verified: "on GitHub", how: "Read the Ruleset." },
      ]),
    ).toEqual([
      { scenario: "Mounting by hand", verified: "by hand", how: "Mounted with Finder." },
      { scenario: "A real bucket", verified: "on a real deployment", how: "Wrote to R2." },
      { scenario: "A required check", verified: "on GitHub", how: "Read the Ruleset." },
    ]);
  });

  it.each([
    [
      "an entry with a key of its own",
      [{ scenario: "A", verified: "by hand", how: "So.", when: "today" }],
      "entry 1 of tests/verified-elsewhere.yaml has a key it should not have: when",
    ],
    [
      "an entry without a way it was verified",
      [{ scenario: "A", verified: "by hand" }],
      "entry 1 of tests/verified-elsewhere.yaml has no how",
    ],
    [
      "an entry with an empty scenario",
      [{ scenario: " ", verified: "by hand", how: "So." }],
      "entry 1 of tests/verified-elsewhere.yaml has no scenario",
    ],
    [
      "an entry that is not a mapping",
      ["Mounting by hand"],
      "entry 1 of tests/verified-elsewhere.yaml has no verified",
    ],
  ])("refuses %s", (_what, parsed, message) => {
    expect(() => verifiedEntries(parsed)).toThrow(message);
  });
});

describe("carries", () => {
  it.each([
    ["Replacing a file", "Replacing a file", true],
    ["Replacing a file: R2", "Replacing a file", true],
    ["Replacing a file: R2: twice", "Replacing a file: R2", true],
    ["Replacing a file twice", "Replacing a file", false],
    ["Replacing a file:", "Replacing a file", false],
    ["replacing a file: R2", "Replacing a file", false],
    [": Replacing a file", "", false],
  ])("a test named %j carries the scenario %j: %s", (test, scenario, expected) => {
    expect(carries(test, scenario)).toBe(expected);
  });
});

describe("coverage", () => {
  const storage = "openspec/specs/storage/spec.md";
  const listing = "openspec/specs/listing/spec.md";
  const scenario = (name: string, spec = storage): Scenario => ({ spec, name });

  it("passes a scenario that a test carries by its name or with a suffix", () => {
    expect(
      coverage(
        [scenario("Replacing a file"), scenario("Creating a collection")],
        ["Replacing a file: R2", "Creating a collection"],
        [],
      ),
    ).toEqual({ failures: [], elsewhere: [], tested: 2, scenarios: 2 });
  });

  it("passes a scenario that the list records, and reports it", () => {
    expect(coverage([scenario("Mounting by hand")], [], [byHand("Mounting by hand")])).toEqual({
      failures: [],
      elsewhere: [byHand("Mounting by hand")],
      tested: 0,
      scenarios: 1,
    });
  });

  it("counts a scenario that has a test and an entry as tested", () => {
    expect(
      coverage([scenario("Replacing a file")], ["Replacing a file"], [byHand("Replacing a file")]),
    ).toEqual({ failures: [], elsewhere: [], tested: 1, scenarios: 1 });
  });

  it("fails a scenario without a test or an entry", () => {
    expect(
      coverage([scenario("Replacing a file")], ["Replacing a file twice"], []).failures,
    ).toEqual([
      `${storage}: "Replacing a file" has no test that carries its name, and no entry in tests/verified-elsewhere.yaml.`,
    ]);
  });

  it("fails two scenarios with one name, naming both specs", () => {
    expect(
      coverage(
        [scenario("Listing a collection", listing), scenario("Listing a collection")],
        ["Listing a collection"],
        [],
      ).failures,
    ).toEqual([`2 scenarios share the name "Listing a collection", in ${listing} and ${storage}.`]);
  });

  it("fails an entry whose scenario does not exist, and one listed twice", () => {
    expect(
      coverage(
        [scenario("Mounting by hand")],
        [],
        [byHand("Mounting by hand"), byHand("Removing a backend"), byHand("Mounting by hand")],
      ).failures,
    ).toEqual([
      'tests/verified-elsewhere.yaml lists "Mounting by hand" 2 times.',
      'tests/verified-elsewhere.yaml lists "Removing a backend", which no scenario in openspec/specs has.',
    ]);
  });

  it("prints a report with its failures", () => {
    const report = coverage(
      [scenario("Mounting by hand"), scenario("Replacing a file")],
      [],
      [byHand("Mounting by hand")],
    );
    expect(formatReport(report)).toBe(
      [
        "2 scenarios: 0 with a test that carries their name, 1 verified elsewhere.",
        '"Mounting by hand" is verified by hand: So.',
        "",
        "Requirement coverage fails:",
        `- ${storage}: "Replacing a file" has no test that carries its name, and no entry in tests/verified-elsewhere.yaml.`,
      ].join("\n"),
    );
  });
});

describe("configurations", () => {
  it("finds the Vitest and Playwright configurations of the repository", () => {
    const found = configurations(root);
    expect(found.vitest[0]).toBe("vitest.config.ts");
    expect(found.vitest).toEqual(
      expect.arrayContaining([
        "tests/integration/compat/vitest.bun-sqlite.config.ts",
        "tests/integration/compat/vitest.cloud.config.ts",
        "tests/integration/compat/vitest.d1.config.ts",
        "tests/integration/compat/vitest.http.config.ts",
      ]),
    );
    expect(found.playwright).toEqual(["tests/integration/compat/playwright.config.ts"]);
  });

  it("finds the configurations of every workspace, and nothing in a file that a pattern matches", () => {
    const repository = mkdtempSync(join(tmpdir(), "requirement-coverage-"));
    try {
      const write = (path: string, content = "") => {
        mkdirSync(join(repository, path, ".."), { recursive: true });
        writeFileSync(join(repository, path), content);
      };
      write("package.json", JSON.stringify({ workspaces: ["packages/*"] }));
      write("vitest.config.ts");
      write("packages/README.md");
      write("packages/a/vitest.config.ts");
      write("packages/b/playwright.config.ts");
      write("packages/b/vitest.unit.config.mts");
      write("packages/b/vite.config.ts");
      expect(configurations(repository)).toEqual({
        vitest: [
          "vitest.config.ts",
          "packages/a/vitest.config.ts",
          "packages/b/vitest.unit.config.mts",
        ],
        playwright: ["packages/b/playwright.config.ts"],
      });
      write("package.json", "{");
      expect(() => configurations(repository)).toThrow(SyntaxError);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("finds the configuration of a repository without workspaces", () => {
    expect(configurations(join(fixtures, "passing"))).toEqual({
      vitest: ["vitest.config.ts"],
      playwright: [],
    });
  });
});

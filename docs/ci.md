# CI

GitHub Actions runs Davloom's checks on every pull request, whatever its base branch, and on every push to `main`. The workflow has no branch filter because stacked pull requests target each other's branches until GitHub retargets them to `main`. Every job calls a command that also runs on a contributor's machine, so a failed job can be reproduced locally with the command in the table below. The plan behind this layout is the OpenSpec change `add-ci-baseline`.

## Jobs

`.github/workflows/ci.yml` holds the jobs. Each runs on `ubuntu-24.04` with a 20-minute timeout and starts with the local action `.github/actions/setup`. A newer push to the same pull request or branch cancels the run in progress.

| Job            | What it runs                                                                                                                                                                                                                | Local command                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `check`        | Lint with the type-aware rules, the format check, the check that Astryx and StyleX are pinned and in range, the generated theme check, the typecheck, the unit tests and the production builds                              | `bun run check`                                                                                                                        |
| `compat`       | The HTTP compatibility tests on Bun and workerd, Better Auth on D1 and Bun SQLite, the Playwright tests against the production build on both runtimes, the brand change check and the Cloud Free tests that need no account | `bun run --filter @davloom/compat-tests playwright:install` once, then `bun run test:compat`                                           |
| `coverage`     | The unit tests with Istanbul coverage and the per-package thresholds, then each package's coverage in the job summary                                                                                                       | `bun run test:coverage`, then `bun run coverage:summary`                                                                               |
| `dependencies` | OSV-Scanner on every package in `bun.lock`, transitive ones included                                                                                                                                                        | `bun run scan:deps`                                                                                                                    |
| `secrets`      | Gitleaks on the commits a pull request adds, or on the whole history after a push to `main`                                                                                                                                 | `bun run scan:secrets` for the whole history, or `bun run scan:secrets --log-opts=origin/main..HEAD` for the commits not yet on `main` |

The setup action first puts `.github/actions/setup/no-node` at the front of `PATH`. A step that calls `node`, or starts a launcher whose shebang names Node, then fails instead of running the Node that the runner image ships. The action then installs the Bun release that `packageManager` in `package.json` names and runs `bun install --frozen-lockfile --ignore-scripts`. The scan jobs pass `install: "false"` and skip the install, because they only run a pinned CLI.

`.github/workflows/dependency-scan.yml` runs the dependency scan on `main` every Monday at 04:23 UTC, so a vulnerability published for a dependency already on `main` fails a run even when no pull request is open. A maintainer can start it by hand from the Actions tab or with `gh workflow run dependency-scan.yml`.

## Pinned tools

OSV-Scanner and Gitleaks are release binaries, not npm packages and not third-party actions (Decision 5 of `add-ci-baseline`). `scripts/lib/tools.ts` pins each one's version and the SHA-256 of its download for macOS and Linux on arm64 and x64. `bun scripts/tool.ts <name> [arguments]` downloads the build for the current machine once, fails without caching it when its SHA-256 differs from the pin, and runs it. The cache is `~/.cache/davloom/tools`, or `$XDG_CACHE_HOME/davloom/tools`, or `$DAVLOOM_TOOL_CACHE`, and every checkout shares it.

To move a tool to a newer release, take the version from its latest GitHub release, not a pre-release, and the SHA-256 of each of the four downloads from the release's checksum file. GitHub shows the same value as the asset's digest (`gh api repos/<owner>/<repo>/releases/tags/<tag> --jq '.assets[] | [.name, .digest]'`), which is the only source for a release without a checksum file.

## Required checks

Decision 6 of `add-ci-baseline` makes the `main` Ruleset require `check`, `compat`, `coverage`, `workflows`, `secrets` and `dependencies`, plus the CodeQL results at High or higher. A required check that has never run blocks every pull request, so task 7.2 adds each job only after it has run on `main`. Until then the Ruleset requires a pull request but no status check, and agents merge their own pull requests only once every check on them passes (Pull requests in `CLAUDE.md`).

## Running CI's commands locally

Install the way CI does:

```bash
bun install --frozen-lockfile --ignore-scripts
```

A frozen install fails when `package.json` and `bun.lock` disagree, locally as in CI. `--ignore-scripts` skips the postinstall of `workerd`, the one dependency script that Bun would run, which calls Node and which nothing needs.

To catch a call to Node before CI does, put the same guard first on `PATH`:

```bash
PATH="$PWD/.github/actions/setup/no-node:$PATH" bun run check
```

`bun run test:compat` needs Chromium. `playwright:install` downloads the build that Playwright pins, or `DAVLOOM_CHROMIUM_PATH` can point the tests at a Chromium that is already installed. The cases that need a real Cloudflare deployment show as skipped, locally and in CI.

## Coverage gates

`vitest.config.ts` keys each package's thresholds by its `src` glob, such as `packages/core/src/**`. A package starts at the coverage measured when its gate was added. Its thresholds then only go up, toward the V1 targets in section 11 of the PRD, and lowering one needs a reason in the `design.md` of the change that lowers it. `scripts/coverage-thresholds.test.ts` fails when a package under `apps/` or `packages/` has no `src` directory or no thresholds.

`bun run test:coverage` prints a row for each file and package. When a package falls below a threshold, it exits with a non-zero status and names the package and the metric. It also writes `coverage/coverage-summary.json`, which `bun run coverage:summary` turns into the table that the `coverage` job adds to its summary: each package's lines, branches, functions and statements, with the covered and total counts and the threshold. The table command fails too when a package is below a threshold. Vitest writes no report when a test fails, and the summary then says so in place of the table.

## Vulnerable dependencies

The `dependencies` job fails when OSV-Scanner finds a published vulnerability in any package that `bun.lock` resolves. The log lists each one with its OSV URL, which ends in the vulnerability's ID, and with the package, its version and the first fixed version. A vulnerability published today fails every pull request until it is dealt with, and the weekly run fails on `main` as well.

Fix it first. `bun why <package>@<version>` shows which dependency pulls the vulnerable version in, and an update of that dependency to its npm `latest` release often brings the fixed version.

When no `latest` release fixes it and the vulnerable code does not run in Davloom, register an exception in `osv-scanner.toml`:

```toml
[[IgnoredVulns]]
id = "GHSA-67mh-4wv8-2f99"
ignoreUntil = 2027-02-19
reason = "Why the vulnerable code does not run in Davloom, and what will remove the exception"
```

The `id` comes from the log. `ignoreUntil` is the date when someone has to look again, a few months out; once it has passed, the scan fails again, and the exception is either renewed with a current reason or removed. `bun run scan:deps` then prints the vulnerability with the words "has been filtered out because" and the reason, and passes. The repository keeps one exception today: GHSA-67mh-4wv8-2f99 in esbuild 0.18.20, which `drizzle-kit` 0.31.11 pulls in through `@esbuild-kit/esm-loader` to transpile `drizzle.config.ts`. The advisory concerns esbuild's development server, which nothing in Davloom starts.

## Secret findings

The `secrets` job fails when Gitleaks finds something that looks like a credential in a commit. The log names the rule, the file, the line and the commit, shows `REDACTED` in place of the value, and gives the finding's fingerprint.

If the value is a real credential, revoke it at its provider first. The repository is public, so the commit stays readable on GitHub through the pull request's refs even after the branch changes. Then take it out of the branch.

If the value only looks like a credential, such as a test value, change it to one that Gitleaks does not flag, or end its line with a `gitleaks:allow` comment, which makes Gitleaks skip that line. A finding in a commit that can no longer change goes into `.gitleaksignore` as its fingerprint, on a line of its own, with a comment above it that says why. The allowlist in `.gitleaks.toml` holds only the secret that the compatibility tests give Better Auth, and nothing else goes there.

Before pushing, `bun run scan:secrets --log-opts=origin/main..HEAD` scans the commits that are not on `main` yet, as the job scans a pull request.

## Test budget

Section 11 of the PRD sets a budget of at least 8,000 unique test cases at V1. The plan holds about 9,500, and a full CI run executes about 18,000, because a case runs once for every runtime, backend or browser in its matrix. One `it` or `test` is one case, and so is each row of an `it.each` table. On `b572cf1` (2026-11-19) the repository held 630 cases:

| Layer (PRD §11)                               |   V1 budget | On 2026-11-19 |
| --------------------------------------------- | ----------: | ------------: |
| Unit: `packages/webdav`                       |       1,670 |             0 |
| Unit: `packages/core`                         |       2,190 |             7 |
| Unit: other packages                          |         400 |           163 |
| Property and fuzz                             |         260 |             0 |
| Effect Services                               |         450 |             0 |
| Storage contract                              |         300 |             0 |
| Database contract and upgrade                 |         350 |             0 |
| WebDAV protocol, black-box                    |       1,240 |             0 |
| Permissions and security, black-box           |       1,190 |             0 |
| Concurrency and fault recovery                |         200 |             0 |
| Management API and quota                      |         340 |             0 |
| Real clients                                  |         130 |             0 |
| Data migration                                |         300 |             0 |
| Browser E2E                                   |         366 |           245 |
| Runtime compatibility and release smoke tests |         110 |           169 |
| Total                                         | about 9,500 |           584 |

The 163 unit cases of other packages are 116 in `apps/web`, 38 in `packages/ui` and 9 in `packages/auth`. The browser row counts the 245 Playwright tests, which run 485 times across the `bun` and `workers` projects; about 20 of them check how a runtime serves the app rather than a page flow. The compatibility row holds the 118 HTTP tests, the 12 Better Auth tests (6 on D1, 6 on Bun SQLite), the 4 brand change checks and the 35 Cloud Free tests. Those 35 run twice: against a local probe, where 34 pass, and against a real deployment, where 24 are skipped without an account. The 46 tests in `scripts/` check the repository's own tooling and sit outside the budget, which brings the total to 630. The rows still at 0 arrive with the phases that build their code. The unit cases were counted with Vitest's JSON reporter, the browser tests with `playwright test --list`, and the other compatibility tests from the log of the `compat` job.

## Run times

These pairs ran on the same code: `b572cf1` on an M4 Pro with 12 CPUs, and CI run 44508446051 on `ebdca58`, which differs from `b572cf1` only by the Phase 1 proposal documents.

| Stage                                      | How it runs                                                                    |  M4 Pro |      CI | Factor |
| ------------------------------------------ | ------------------------------------------------------------------------------ | ------: | ------: | -----: |
| `bun run check`                            | Vitest with a pool of workers, lint and typecheck on several threads           |    14 s |    21 s |    1.5 |
| HTTP compatibility tests (118)             | One test file at a time                                                        |  18.0 s |  32.3 s |    1.8 |
| Better Auth on D1 (6)                      | One test file                                                                  |   2.1 s |   3.8 s |    1.8 |
| Better Auth on Bun SQLite (6)              | One test file                                                                  |  0.27 s |  0.49 s |    1.8 |
| Cloud Free, local (35)                     | One test file at a time                                                        |   5.9 s |   9.1 s |    1.5 |
| Playwright (485 runs, 1 skipped by design) | One worker for every two CPUs                                                  | 1.4 min | 5.0 min |    3.6 |
| `bun run test:compat` as a whole           | The stages above other than `check`, the brand change check and two web builds |   122 s |   373 s |    3.1 |

On CI the whole `check` job took 40 s and `compat` took 6 min 29 s. Outside Playwright, every stage in the table took 1.5 to 1.8 times as long on the runner as on the M4 Pro, whether it runs one test file at a time or spreads its work over workers and threads as `bun run check` does. Playwright took 3.6 times as long, because one worker for every two CPUs gives it 6 workers on the M4 Pro and 2 on the runner's 4 CPUs. One browser run costs a CI worker about 1.2 s. The brand change check has no row. It took 12.1 s on the M4 Pro and 13.3 s on the runner, a factor of 1.1 that no other stage shares, most of it in two builds, and its Playwright part alone took 2.2 s in one local run and 5.8 s in the next, so one pair of runs gives it no reliable factor.

The first runs, on 2026-11-16, were shorter because the suite was smaller. The `check` job of task 3.1 took 31 s with a cold cache, 12 s of it in `bun run check`, and the `compat` job of task 3.2 took 86 s, 61 s of it in `bun run test:compat`. The dashboard prototype has since added about 220 browser tests.

## Target job layout

By V1 a pull request runs about 20 jobs (Decision 10 of `add-ci-baseline`). The estimates below scale measurements on the M4 Pro by the factors above: 1.5 to 1.8 outside Playwright, instead of the 2 to 2.5 that Decision 10 first assumed. That multiplies its first estimates for `check`, `coverage`, the contract jobs, the deployment jobs and the migration job by about 0.73. Browser jobs are estimated at 1.2 s per run for each of their 2 workers, against the 2 to 3 s per test first assumed. The `compat` row is a measurement, and CodeQL and the scans keep their first estimates until they have run on CI.

| Jobs                                   | Contents                                                                                                                                                  | Estimate per job                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `check`                                | Lint, format, types, unit tests and build, plus the Bend proofs and the requirement coverage check from Phase 1; uploads the web build for the other jobs | 4–4.5 min, more once the Bend proofs land                        |
| `coverage`                             | Unit tests with the coverage gates                                                                                                                        | 2–3 min                                                          |
| 2 contract jobs                        | Storage and database contracts                                                                                                                            | 2–3 min                                                          |
| 4 deployment jobs, one per combination | Protocol, security, management API, quota, concurrency, rclone and litmus                                                                                 | 6–7.5 min                                                        |
| Migration                              | Data migration                                                                                                                                            | About 3 min                                                      |
| 6 browser shards                       | Playwright, 2 workers per shard                                                                                                                           | 4–6 min                                                          |
| `compat`                               | Phase 0 compatibility tests                                                                                                                               | 6.5 min today, while it still runs the dashboard's browser tests |
| CodeQL                                 | Static analysis                                                                                                                                           | 8–10 min                                                         |
| `dependencies`, `secrets`, `workflows` | Scans                                                                                                                                                     | About 2 min                                                      |

The browser shards and the deployment jobs wait for the web build from `check`, so a pull request should take about 10 to 12 minutes of wall-clock time and about an hour and a half of runner time. Standard runners are free for public repositories, but a free account runs at most 20 jobs at once, so a second pull request at the same moment queues part of its jobs. Each phase that adds tests measures its jobs again and updates this page.

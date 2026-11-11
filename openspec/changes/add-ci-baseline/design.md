# Design

## Context

See proposal.md for the motivation and the specs for the behavior requirements.

Phase 0 left two entry points: `bun run check` runs lint, format, exact versions, generated theme, types, unit tests and builds; `bun run test:compat` runs the Workers, Bun and Playwright compatibility tests and exits with status 0 when there are no Cloudflare credentials. The repository is on GitHub but has no `.github/` yet.

Current state relevant to CI (checked on 2026-11-06):

- HTTP tests run Vitest on Node and start real Bun and `wrangler dev` processes, and the Bun SQLite tests run on Bun with `bun --bun vitest`. The maintainer ruled out Node on 2026-11-07, so these move to Bun first (Decision 7).
- The Bun version is set in `packageManager` of the root `package.json` (`bun@1.4.4`), and `oven-sh/setup-bun` reads this field by default.
- `apps/api` and `tests/integration/compat` each have two tsconfig files: `tsconfig.json` for Bun and `tsconfig.workers.json` for Workers. Each excludes the entry files of the other.
- `scripts/lib/pinned-deps.ts` only checks that Astryx and StyleX are declared with exact versions; it does not compare StyleX with the Astryx peer dependency. Astryx 0.7.8 requires `@stylexjs/stylex` at `^0.19.0`, and 0.19.1 is installed now.
- The test fixture `compatibility-test-secret-not-used-anywhere-else` appears in 4 files.
- `bun outdated --filter '*'` lists no dependencies that are behind.
- Under Bun 1.4.4, `bun --bun vitest run --coverage` works with both the V8 and the Istanbul provider, but Cloudflare's Vitest integration supports only Istanbul (checked on 2026-11-07).

## Goals / Non-Goals

**Goals:**

- CI calls only commands that also run locally, and does not rewrite test logic in a workflow.
- When a later Phase adds tests, it only needs to wire them into an existing command or add a job.

**Non-Goals:**

- Do not implement deployment or release. Wrangler, Buildx, Changesets and Trivy are left for Phase 6.
- Do not run the Cloud Free real-deployment measurement on pull requests. It needs an account and consumes that day's quota. It is rerun by hand after a dependency upgrade.
- Do not add the requirement coverage check or StrykerJS. Phase 0 tests carry no scenario IDs, so both start in Phase 1 with the code they measure, as section 11 of the PRD says.
- Do not build the whole V1 job layout. The baseline adds the jobs in Decision 1, and later phases add the rest of Decision 10.

## Decisions

### 1. One main workflow, with jobs split by run time

| Job | Content | Required |
| --- | --- | --- |
| `check` | `bun install --frozen-lockfile`, `bun run check` | Yes |
| `compat` | Install Chromium, `bun run test:compat` | Yes |
| `workflows` | actionlint, zizmor | Yes |
| `secrets` | Gitleaks | Yes |
| `dependencies` | OSV-Scanner scans `bun.lock` | Yes |
| `coverage` | Vitest with Istanbul coverage, per-package gates, results written to the job summary | Yes |

Pull requests trigger the workflow whatever their base branch, because stacked pull requests target each other's branches before they are retargeted to `main`.

CodeQL gets its own workflow because it needs `security-events: write`, which keeps it separate from the other read-only jobs. The scheduled dependency vulnerability scan reuses the steps of `dependencies` and runs once a week.

`check` and `compat` are separate because `compat` installs a browser and uploads 1 GiB, which takes much longer, and most failures already show up in `check`. Putting every check in one job would also work, but then a failure means paging through the whole log, and Rulesets could require only one status.

### 2. Fold type-aware rules into `bun run lint`

`oxlint-tsgolint` provides the type-aware rules. On 2026-11-06, `oxlint-tsgolint` 7.0.2006 was tried on the repository, wrapped in a throwaway directory, with nothing written into the repository:

- The whole repository took about 1.7 seconds, so no separate job is needed. Turn on `options.typeAware` in `oxlint.json` and let `bun run lint` run it.
- tsgolint looks for the nearest `tsconfig.json` for each file. The 9 files that only the Workers config includes found no config, were checked as files without type information, and produced 5 `error typed` false positives.
- In a copy, the `tsconfig.json` of the two directories was changed to contain only `files: []` and `references` that point to `tsconfig.bun.json` and `tsconfig.workers.json`. tsgolint then built 11 programs with no unmatched files, and the false positives went away. On `apps/api`, `tsc -p` exits with status 0 for all three configs.
- The remaining 43 are real problems: 30 `no-unsafe-type-assertion`, 7 `unbound-method`, 3 `no-misused-spread`, 2 `no-unnecessary-type-assertion` and 1 `no-unnecessary-type-arguments`. Of these, 41 are in `tests/integration/compat`.
- With one unhandled Promise in a Bun file and one in a `*.workers.ts` file, `no-floating-promises` reports both.

At implementation time, fix these 43 first and then turn the rules on, without disabling any rule. If a rule really has to be disabled, record the reason here. `tsc` stays the basis for type checking.

Implemented on 2026-11-07 without turning any rule off in `oxlint.json`. JSON bodies are now checked with Effect Schema through `tests/integration/compat/shared/json.ts`, and the Workers bindings come from `Cloudflare.Env` declarations instead of casts. Two lines keep an assertion behind `oxlint-disable-next-line typescript/no-unsafe-type-assertion`, because there the assertion is the point:

- The D1 usage counter in the probe stands in for `D1Database` but implements only `prepare` and `batch`, the two methods Drizzle calls.
- A test in `packages/core` passes `responseFromExit` an error outside the declared union, to check that it becomes a defect.

### 3. Use Renovate, not Dependabot

Bun is not in the [supported list](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems) of the GitHub dependency graph, so the graph cannot read `bun.lock`, and Dependabot alerts and Dependency Review, which build on it, cannot see the transitive dependencies in the lockfile. The Renovate option `vulnerabilityAlerts`, which reads GitHub vulnerability alerts, also requires the dependency graph to be on, so `osvVulnerabilityAlerts` is used instead. It uses OSV data and covers only direct dependencies.

Key settings, based on the Renovate [configuration options documentation](https://docs.renovatebot.com/configuration-options/) and the [Minimum Release Age explanation](https://docs.renovatebot.com/key-concepts/minimum-release-age/):

- No waiting period and no `schedule`: after a new version is published, Renovate opens a PR on its next run (the maintainer decided this on 2026-11-06). `minimumReleaseAge` is not set, and a regular schedule would also delay updates indirectly, so neither is used. Grouping and `prConcurrentLimit` control the number of PRs, and automerge stays off.
- Turn on the Dependency Dashboard, which lists all pending updates in one issue.
- Keep versions exact, in line with `exact = true` in `bunfig.toml`.
- `osvVulnerabilityAlerts` opens a separate PR for security fixes to direct dependencies.
- Lock File Maintenance refreshes `bun.lock` weekly, so transitive dependencies get fixes.
- The Astryx packages form one group. `@stylexjs/*` is limited by `allowedVersions` to the Astryx peer dependency range. When an Astryx upgrade changes that range, upgrade StyleX and update `allowedVersions` in the same PR. The single check command gains one check: the installed StyleX must satisfy the Astryx peer range, or the check fails.
- The github-actions manager updates both the SHA of an action and the version comment after it, so pinned versions do not slowly go stale.

Implemented on 2026-11-11. For each Astryx or StyleX package that a workspace declares, `scripts/check-pinned-deps.ts` reads the installed `package.json` through `node_modules`, starting from that workspace, and fails when a StyleX package is outside the range an Astryx package declares for it. StyleX publishes all its packages under one version, so a StyleX package that Astryx does not name, such as `@stylexjs/unplugin`, is held to the range for `@stylexjs/stylex`. The check also fails when a declared package is missing from `node_modules` or installed at another version than its manifest declares, so a stale install cannot hide a version, and when it cannot read a peer range, because `Bun.semver.satisfies` accepts strings it cannot parse, such as `latest`, and reads some forms npm rejects, such as `- 0.19.0` or `*-beta`, as any version. The check reads comparators such as `^0.19.0`, `>=0.19.0` or `0.19.x`, with no space after the operator, joined by spaces or `||`, and hyphen ranges between two versions without operators, such as `0.19.0 - 0.19.5`. Their versions follow npm's grammar: a pre-release or build suffix needs all three numbers, only wildcards follow a wildcard, and a number has no leading zero and at most 15 digits. Any other range fails with the range in the message, npm forms such as `>= 0.19.0`, `~>0.19.0` or an empty range included, so an Astryx release that writes one fails the check instead of passing unchecked. These decisions are pure functions in `scripts/lib/pinned-deps.ts` and stay in TypeScript rather than Bend: they check the repository's own dependencies and are none of the logic that section 4 of the PRD lists, the Bend toolchain arrives with `packages/laws` only in Phase 1, and the range comparison uses `Bun.semver`.

### 4. Use OSV-Scanner for dependency vulnerabilities, not Dependency Review

Dependency Review relies on the dependency graph and so cannot see `bun.lock` either. [OSV-Scanner](https://google.github.io/osv-scanner/supported-languages-and-lockfiles/) reads `bun.lock` directly, including transitive dependencies.

Every PR scans the whole lockfile, so a newly published vulnerability fails all PRs. The way to deal with it is to fix it, or to register an exception in `IgnoredVulns` in `osv-scanner.toml` with a `reason` and an `ignoreUntil` expiry date. Once that date passes, the scan fails again.

### 5. Use CLIs at pinned versions for third-party tools

Gitleaks, OSV-Scanner, actionlint and zizmor all run as CLIs at pinned versions, downloaded and then checked against a checksum, and not through third-party actions. This keeps third-party code in the workflow to a minimum and makes the tools easy to reproduce locally. Look up the versions at implementation time, following the project's dependency rules.

In March 2026, [76 tags of `trivy-action` were force-pushed into code that steals credentials](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23). This is the reason for this decision and for pinning actions to a SHA.

The default rules of zizmor 1.32.0 already cover the requirements of `workflow-security`, so no custom configuration is needed. Results of a trial run on 4 sample workflows:

| Sample | Result |
| --- | --- |
| Pinned to a SHA, declares `permissions`, `actions/checkout` does not persist credentials | No problems |
| References an action by tag | `unpinned-uses`, high |
| Does not declare `permissions` | `excessive-permissions`, medium |
| Triggered by `pull_request_target` | `dangerous-triggers`, high |

The Gitleaks author has [declared that only security issues will be fixed](https://github.com/gitleaks/gitleaks), so GitHub native secret scanning is turned on as well. The test fixture `compatibility-test-secret-not-used-anywhere-else` goes into the Gitleaks allowlist.

### 6. Two approvals, which the owner can bypass

The maintainer decided on 2026-11-07 that every CI check must pass for everyone, that the repository owner can merge once the checks pass, and that everyone else needs two approvals. A bypass applies to a whole Ruleset, so `main` gets two:

| Ruleset | Rules | Bypass |
| --- | --- | --- |
| `main` | Block deletion and force pushes, require a pull request, require every job in Decision 1 and the CodeQL results | None, the owner included |
| `main reviews` | Require 2 approvals, dismiss approvals when new commits are pushed | Repository admin role, on pull requests only |

GitHub does not let an author approve their own PR, so the owner bypasses `main reviews` instead of approving. CODEOWNERS names the owners, and code owner review is not required.

Both Rulesets were created on 2026-11-07 without required checks, because a required check that has never run blocks every pull request. Task 7.2 adds the checks once the workflows have run on `main`, and exports both Rulesets as JSON into the repository.

The repository has been public since it was created, ahead of the baseline CI, so Rulesets, CodeQL and native secret scanning are all available on a free account.

Task 7.2 makes the `main` Ruleset require `check`, `compat`, `coverage`, `workflows`, `secrets` and `dependencies` to pass. CodeQL uses its Require code scanning results rule, with Security alerts set to High or higher and Alerts set to Errors.

### 7. Bun only

The maintainer ruled out Node on 2026-11-07: every script, test, tool and CI job runs on Bun. `oven-sh/setup-bun` reads `packageManager`, and no job installs Node. Tools whose launchers start with `#!/usr/bin/env node` run on Bun under `bun --bun run`, which puts a `node` that points to Bun first on `PATH`.

Checked on 2026-11-07 with a logging `node` first on `PATH`: with `[run] bun = true`, `bun run check` passes without calling Node, so `bun run check` now starts each step with `bun --bun run`. With the same setting `bun run test:compat` fails, because `wrangler dev` answers every request with 503 under Bun. Miniflare runs on Bun when it is called directly, so task 2.1 moves the compatibility servers to Miniflare and then sets `[run] bun = true` in `bunfig.toml`.

### 8. Each Phase brings its own CI tasks

From now on, the `tasks.md` of every change includes a task that wires the new tests into CI. This rule goes into the tasks rules of `AGENTS.md`, `CLAUDE.md` and `openspec/config.yaml`, so `/opsx:propose` can see it when it generates tasks.

### 9. Coverage gates that only go up

The maintainer decided on 2026-11-07 to gate coverage, which replaces the earlier plan to report it without a threshold. Section 11 of the PRD sets the V1 targets per package and a test budget of at least 8,000 unique cases.

- `bun run test:coverage` runs `bun --bun vitest run --coverage` with `@vitest/coverage-istanbul`. Cloudflare's Vitest integration supports only Istanbul, so Istanbul is the one provider that measures tests on both Bun and workerd.
- `coverage.include` names every package. Vitest leaves a package with no loaded files out of the report, and its threshold then passes without measuring anything.
- Each package's thresholds start at the coverage that task 2.5 measures and live in the Vitest config, keyed by package path. Each phase raises them toward the V1 targets in section 11 of the PRD, and a change that raises coverage may raise its package's thresholds sooner. Lowering one needs a reason in the `design.md` of that change.
- The `coverage` job fails when any package falls below a threshold, and it writes every package's coverage to the job summary.
- Thresholds are per package, so a pull request fails only for the package whose coverage it lowers.

### 10. Target job layout

The baseline adds the jobs in Decision 1. By V1 a pull request runs about 20 jobs. The estimates scale measurements on an M4 Pro by a factor of 2 to 2.5 and have not run on a GitHub runner yet; task 3.4 corrects the factor with the first-run times.

| Jobs | Contents | Estimate per job |
| --- | --- | --- |
| `check` | Lint, format, types, unit tests and build, plus the Bend proofs and the requirement coverage check from Phase 1; uploads the web build for the other jobs | 5–6 min, more once the Bend proofs land |
| `coverage` | Unit tests with the coverage gates | 3–4 min |
| 2 contract jobs | Storage and database contracts | 3–4 min |
| 4 deployment jobs, one per combination | Protocol, security, management API, quota, concurrency, rclone and litmus | 8–10 min |
| Migration | Data migration | About 4 min |
| 6 browser shards | Playwright, 2 workers per shard | 8–9 min |
| `compat` | Phase 0 compatibility tests | 4–5 min |
| CodeQL | Static analysis | 8–10 min |
| `dependencies`, `secrets`, `workflows` | Scans | About 2 min |

A pull request takes about 13 to 16 minutes of wall-clock time, because the browser shards and the deployment jobs wait for the web build from `check`, and about 2 hours of runner time, and each push to `main` costs the same again. Standard runners are free for public repositories, but a free account runs at most 20 jobs at once, so a second pull request at the same time, such as one from Renovate, queues part of its jobs and finishes 8 to 10 minutes later. If queueing becomes a problem, the scans and `coverage` can fold into fewer jobs.

To reach these times:

- Each workflow sets per-branch `concurrency` with `cancel-in-progress`.
- `check` builds the web app once and passes it on as an artifact.
- Jobs cache Bun's install cache and the Playwright browsers. The Playwright container image is not used, because it ships Node.
- Every job sets `timeout-minutes: 20`.
- HTTP tests start their servers once per job in `globalSetup` and keep cases apart by Mount and path. Today almost all of their time goes into restarting Bun and `wrangler dev` for each `describe` block.
- Workers tests stay serial within a job. `vitest.http.config.ts` turns off file parallelism because `wrangler dev` sessions share a build directory.

Measured on the M4 Pro on 2026-11-07: 23 unit tests took 0.63 s, with a median of 0.13 ms; 110 HTTP tests took 16.4 s, with under 1 s spent in test bodies and medians of 0.5 ms on Bun, 1.5 ms on workerd and 6 ms on workerd with D1 and Durable Objects; and 22 Chromium tests took 6.7 s with one worker, with a median of 164 ms. The largest unknown is the browser average on CI, assumed to be 2 to 3 s per test.

## Differences between Cloudflare Workers and Bun

CI runs on Linux, and both runtimes start locally, with no account needed.

| Aspect | Workers | Bun |
| --- | --- | --- |
| How it runs | Vitest on Node starts `wrangler dev` (workerd) until task 2.1 moves it to Miniflare on Bun, and D1 uses `@cloudflare/vitest-plugin` | Vitest on Node starts a Bun process until task 2.1, and Bun SQLite uses `bun --bun vitest` |
| Type environment | `tsconfig.workers.json` | `tsconfig.bun.json` |
| Browser tests | `wrangler dev` serves the static assets | The Bun process serves them |
| What only a real deployment can verify | CPU and request body limits, shown as skipped in CI | Nothing |

## Risks / Trade-offs

- [`compat` becomes slow or unstable on GitHub-hosted runners, especially the 1 GiB upload and `wrangler dev`] → Record the run time the first time it is added. When it fails repeatedly, look for the root cause first instead of hiding it with retries; adjust the timeout only when the cause lies with the runner alone.
- [A newly published vulnerability fails all PRs] → Fix it, or register an exception with an expiry date; see Decision 4.
- [Versions go stale after pinning to a SHA] → Renovate updates the SHA, through the same flow as dependency updates.
- [A version that is withdrawn or poisoned soon after release goes into a PR right away] → The maintainer chose no waiting period and accepts this risk. Mitigation: automerge stays off and every check must pass before merging; OSV carries malicious package records (`MAL-` IDs), and OSV-Scanner blocks the registered packages among them.
- [Renovate opens too many PRs] → Group similar dependencies and limit how many are open at once with `prConcurrentLimit`.
- [PRs come from untrusted forks once the repository is public] → This is exactly why `pull_request_target` is not used and the checks do not read secrets.
- [The test suite outgrows the CI time budget as the phases add tests] → Follow the rules in Decision 10, and compare each phase's run times with its estimates in `docs/ci.md`.

## Migration Plan

There is no existing CI. The two Rulesets have protected `main` since 2026-11-07, without required checks. Add the workflows first; once all of them have run on `main`, task 7.2 adds their jobs to the required checks of the `main` Ruleset. To roll back, set a Ruleset's enforcement to Disabled or delete the workflow files.

## Open Questions

None. The maintainer decided on 2026-11-06 when the repository goes public and whether to set a waiting period for updates, and on 2026-11-07 the approval rules, that every check is required, and that coverage is gated; see Decisions 3, 6 and 9.

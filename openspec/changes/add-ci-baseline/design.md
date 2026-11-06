# Design

## Context

See proposal.md for the motivation and the specs for the behavior requirements.

Phase 0 left two entry points: `bun run check` runs lint, format, exact versions, generated theme, types, unit tests and builds; `bun run test:compat` runs the Workers, Bun and Playwright compatibility tests and exits with status 0 when there are no Cloudflare credentials. The repository is on GitHub but has no `.github/` yet.

Current state relevant to CI (checked on 2026-11-06):

- HTTP tests run on Node and start real Bun and `wrangler dev` processes, and the Bun SQLite tests run on Bun with `bun --bun vitest`, so CI has to install both Bun and Node.
- The Bun version is set in `packageManager` of the root `package.json` (`bun@1.4.4`), and `oven-sh/setup-bun` reads this field by default. The Node version is not written anywhere.
- `apps/api` and `tests/integration/compat` each have two tsconfig files: `tsconfig.json` for Bun and `tsconfig.workers.json` for Workers. Each excludes the entry files of the other.
- `scripts/lib/pinned-deps.ts` only checks that Astryx and StyleX are declared with exact versions; it does not compare StyleX with the Astryx peer dependency. Astryx 0.7.8 requires `@stylexjs/stylex` at `^0.19.0`, and 0.19.1 is installed now.
- The test fixture `compatibility-test-secret-not-used-anywhere-else` appears in 4 files.
- `bun outdated --filter '*'` lists no dependencies that are behind.

## Goals / Non-Goals

**Goals:**

- CI calls only commands that also run locally, and does not rewrite test logic in a workflow.
- When a later Phase adds tests, it only needs to wire them into an existing command or add a job.

**Non-Goals:**

- Do not implement deployment or release. Wrangler, Buildx, Changesets and Trivy are left for Phase 6.
- Do not run the Cloud Free real-deployment measurement on pull requests. It needs an account and consumes that day's quota. It is rerun by hand after a dependency upgrade.
- Do not set a coverage threshold. The `coverage` job is required like the others, but the coverage level never fails it. Watch the trend first and decide on a threshold after Phase 2.

## Decisions

### 1. One main workflow, with jobs split by run time

| Job | Content | Required |
| --- | --- | --- |
| `check` | `bun install --frozen-lockfile`, `bun run check` | Yes |
| `compat` | Install Chromium, `bun run test:compat` | Yes |
| `workflows` | actionlint, zizmor | Yes |
| `secrets` | Gitleaks | Yes |
| `dependencies` | OSV-Scanner scans `bun.lock` | Yes |
| `coverage` | Vitest V8 Coverage, results written to the job summary | Yes, with no threshold |

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

### 7. Runtime versions

For Bun, `oven-sh/setup-bun` reads `packageManager`. For Node, a new `.node-version` is added; `actions/setup-node` reads it through `node-version-file`, and Renovate also updates it.

### 8. Each Phase brings its own CI tasks

From now on, the `tasks.md` of every change includes a task that wires the new tests into CI. This rule goes into the tasks rules of `AGENTS.md`, `CLAUDE.md` and `openspec/config.yaml`, so `/opsx:propose` can see it when it generates tasks.

## Differences between Cloudflare Workers and Bun

CI runs on Linux, and both runtimes start locally, with no account needed.

| Aspect | Workers | Bun |
| --- | --- | --- |
| How it runs | Vitest on Node starts `wrangler dev` (workerd), and D1 uses `@cloudflare/vitest-plugin` | Vitest on Node starts a Bun process, and Bun SQLite uses `bun --bun vitest` |
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

## Migration Plan

There is no existing CI. The two Rulesets have protected `main` since 2026-11-07, without required checks. Add the workflows first; once all of them have run on `main`, task 7.2 adds their jobs to the required checks of the `main` Ruleset. To roll back, set a Ruleset's enforcement to Disabled or delete the workflow files.

## Open Questions

None. The maintainer decided on 2026-11-06 when the repository goes public and whether to set a waiting period for updates, and on 2026-11-07 the approval rules and that every check is required; see Decision 3 and Decision 6.

# Tasks

## 1. Prerequisites

- [x] 1.1 Confirm that `add-phase-0-foundation` is archived. Verify that `openspec list` no longer lists it and that `openspec/specs/` holds its 4 capabilities
- [x] 1.2 Create a public repository on GitHub and get the maintainer's confirmation before pushing `main`. Verify that `git ls-remote origin main` returns the commit of the local `main` and that the repository settings show Public

## 2. Local checks

- [x] 2.1 Run every command on Bun, with no Node installed or called (Decision 7). `bun run check` starts each step with `bun --bun run`; the compatibility tests start workerd through Miniflare instead of `wrangler dev`, which answers 503 under Bun; then `[run] bun = true` goes into `bunfig.toml`. Verify, with a logging `node` first on `PATH`, that `bun run check` and `bun run test:compat` make no Node call and exit with status 0
- [x] 2.2 Change the `tsconfig.json` of `apps/api` and of `tests/integration/compat` to reference only `tsconfig.bun.json` and `tsconfig.workers.json`, and update the `typecheck` script of each to match. Verify that `bun run typecheck` passes and that the debug log of the type-aware lint shows `Unmatched files: 0`
- [x] 2.3 Add `oxlint-tsgolint` at an exact version, turn on `options.typeAware` in `oxlint.json` and fix the existing problems. Verify that `bun run lint` passes, and that lint fails and names the line when an unhandled Promise is placed in a Bun file and in a `*.workers.ts` file
- [ ] 2.4 Add a check of StyleX against the Astryx peer dependency range to `scripts/lib/pinned-deps.ts` and wire it into `bun run check`. Verify that unit tests cover both the in-range and the out-of-range case, and make the descriptions of this check in `AGENTS.md` and `CLAUDE.md` match the implementation
- [ ] 2.5 Add `@vitest/coverage-istanbul` at the exact version of Vitest, add `bun run test:coverage` running `bun --bun vitest run --coverage` with `coverage.include` set to every package, measure each package's coverage, and set its thresholds in the Vitest config to the measured values (Decision 9). Verify that the command writes a report listing every package, one without tests included, that it fails and names the package when a threshold is set one point above its measured value, and that it passes at the measured values

## 3. Pull request checks

- [ ] 3.1 Create the `check` job in `.github/workflows/ci.yml`: trigger it on pull requests and on pushes to `main`, set `permissions: contents: read` at the workflow level, make `actions/checkout` not persist credentials, pin actions to a SHA, read Bun from `packageManager`, install no Node and keep the runner's preinstalled Node from running any step (Decision 7), and run `bun install --frozen-lockfile` and `bun run check`. Verify that the job passes on a test branch, that a logging `node` first on `PATH` records no call in any step, and that the install step fails when only `package.json` is changed and `bun.lock` is not updated
- [ ] 3.2 Add the `compat` job: cache the Playwright browsers and run `playwright:install` and `bun run test:compat`. Verify that the job passes and that the cases which need a real deployment show as skipped in the log
- [ ] 3.3 Add the `coverage` job: run `bun run test:coverage` and write every package's coverage to the job summary. Verify that the summary lists each package, and that the job fails on a throwaway branch that lowers a package below its threshold
- [ ] 3.4 Create `docs/ci.md`, stating the local command for each job, which checks are required, the test budget from section 11 of the PRD and the target job layout from Decision 10. Record how long the first runs of 3.1 and 3.2 took and use them to correct the scaling factor in Decision 10. Verify that every command in the text gives the same result locally as in CI

## 4. Security scans

- [ ] 4.1 Add the `dependencies` job: download a pinned version of OSV-Scanner and verify its checksum, scan `bun.lock`, and record exceptions in `osv-scanner.toml`. Verify that the scan passes on the current lockfile; that it fails and prints the vulnerability ID on a throwaway lockfile that contains a version with a published vulnerability; and that it passes after an unexpired exception is registered and fails again after the exception expires
- [ ] 4.2 Add the `secrets` job: download a pinned version of Gitleaks and verify its checksum, scan the commits that a pull request adds, redact secrets in the output, and keep only the test fixture in the allowlist. Verify that a scan of the full history passes, and that after a fake cloud service secret is committed on a throwaway branch the scan fails and the output does not contain the full secret
- [ ] 4.3 Create `.github/workflows/codeql.yml` and grant `security-events: write` only to its job. Verify that CodeQL analysis results appear on `main` and that the log shows no TypeScript extraction errors
- [ ] 4.4 Add a weekly scheduled run and a manual trigger to the dependency scan. Verify that one manual trigger succeeds
- [ ] 4.5 Document in `docs/ci.md` how to register a vulnerability exception and how to handle a secret false positive. Verify that following the steps in the text reproduces the results of 4.1 and 4.2 locally

## 5. Workflow security

- [ ] 5.1 Add the `workflows` job: download pinned versions of actionlint and zizmor and verify their checksums, and check `.github/workflows/`. Verify that all workflows in the repository pass, and that the four throwaway workflows (one that references an action by tag, one that does not declare `permissions`, one triggered by `pull_request_target`, and one with a syntax error) all fail
- [ ] 5.2 Confirm that no workflow references any secrets other than `GITHUB_TOKEN`, and have the maintainer open a test pull request from a fork with another account. Verify that all required checks run and that the results match those of a branch in the repository

## 6. Dependency updates

- [ ] 6.1 Create `renovate.json` per Decision 3 in design.md. Verify that `renovate-config-validator` passes
- [ ] 6.2 Have the maintainer install the Renovate App on GitHub. Verify that the Dependency Dashboard appears and lists the OSV vulnerability summary, and that the version specifier in the first update pull request is still an exact version and its checks pass
- [ ] 6.3 Document in `docs/ci.md` the Renovate rules and the steps for upgrading StyleX along with Astryx. Verify that the steps in the text match `renovate.json`

## 7. Repository configuration

- [ ] 7.1 Create `.github/CODEOWNERS`. Verify that the pull request page shows the owner of each directory
- [ ] 7.2 The `main` and `main reviews` Rulesets have existed since 2026-11-07 (Decision 6). Once the checks in groups 3 to 6 have run on `main`, add the jobs that Decision 6 lists to the required checks of `main` and use Require code scanning results for CodeQL, then export both Rulesets as JSON into the repository. Verify that direct pushes and force pushes are rejected, that a pull request with a failing check cannot be merged even by the owner, that the owner can merge a pull request without approvals once the checks pass, and that the fork pull request from 5.2, viewed from the second account, shows two required approvals
- [ ] 7.3 Turn on GitHub native secret scanning and push protection. Verify that the settings page shows both as enabled

## 8. Project rules

- [ ] 8.1 Add the rule "every change's tasks.md includes a task that wires the new tests into CI" to the tasks rules of `AGENTS.md`, `CLAUDE.md` and `openspec/config.yaml`, and point to `docs/ci.md` in Commands. Verify that the output of `openspec instructions tasks` contains this rule

## Workflow follow-up

- Before implementation starts, and with the maintainer's agreement, create sub-issues in the Linear project davloom that carry the same numbers as the tasks above.
- Archive this change after the maintainer has reviewed it.
- After archiving, confirm that `openspec/specs/` contains the specs of the 4 new capabilities.

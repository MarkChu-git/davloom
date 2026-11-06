# Proposal

## Why

Every check runs only on the local machine today, and nothing stops a change that fails the checks from reaching `main`. Storage and protocol code will grow quickly after Phase 1, so a baseline CI should go in first, once Phase 0 is archived. After that, each Phase only adds its own tests to it.

## What Changes

- Required quality checks for PRs: installing dependencies from the lockfile, Oxlint (including type-aware rules), Oxfmt, TypeScript, Vitest, Workers and Bun compatibility tests, Playwright, and the production build.
- Required security scans for PRs: OSV-Scanner, Gitleaks and CodeQL.
- Security of the workflows themselves: actions pinned to a commit SHA, minimal `permissions`, no `pull_request_target`, and checks by actionlint and zizmor.
- Dependency updates: Renovate keeps proposing updates and keeps versions exact.
- Repository configuration: GitHub Rulesets protect `main`, and CODEOWNERS names the owners without enforcing review.
- Coverage: Vitest V8 Coverage reports the trend only and does not block merging.
- Three supporting local changes: the `tsconfig.json` of `apps/api` and of `tests/integration/compat` changes to reference the Bun and Workers configs separately; the single check command gains a check of StyleX against the Astryx peer dependency; the Node version is written to `.node-version`.
- Project rule: from now on, the `tasks.md` of every Phase includes a task that wires the new tests into CI.

Not included: Testcontainers + RustFS and StrykerJS (Phase 1), RFC tests + litmus (Phase 2), k6 (Phase 5), and the release pipeline (Phase 6). oasdiff, Lighthouse CI, CodSpeed and Cosign are not added for now. The plan for these is in section 11 of the PRD.

## Capabilities

### New Capabilities

- `pull-request-checks`: Quality checks and security scans that a pull request must pass before it merges.
- `workflow-security`: Constraints on the permissions, triggers and third-party actions of the CI workflows themselves.
- `dependency-updates`: How dependencies are updated continuously, and how new versions and known vulnerabilities are handled.
- `branch-protection`: Which changes the `main` branch accepts, and the approval rules while there is a single maintainer.

### Modified Capabilities

None. `repository-checks` comes from `add-phase-0-foundation`, which is not archived yet, so it cannot be a Modified Capability before archiving. The StyleX peer dependency check is written in `dependency-updates`, and the existing requirements of `repository-checks` do not change.

## Impact

- Code: adds `.github/workflows/`, `.github/CODEOWNERS`, `renovate.json`, `osv-scanner.toml`, the Gitleaks configuration, `.node-version` and `docs/ci.md`; `oxlint.json` turns on the type-aware rules; `apps/api` and `tests/integration/compat` get an adjusted tsconfig structure; `scripts/lib/pinned-deps.ts` gains a peer dependency check; new dev dependencies `oxlint-tsgolint` and `@vitest/coverage-v8`.
- External systems: needs a GitHub repository and the Renovate GitHub App. On a free GitHub account, Rulesets support only public repositories, and CodeQL and native secret scanning are also free only for public repositories.
- Prerequisites: `add-phase-0-foundation` is finished and archived, and the compatibility test command exits with status 0 when there are no cloud credentials.
- Docs: `AGENTS.md`, `CLAUDE.md` and `openspec/config.yaml` gain CI rules. `AGENTS.md` and `CLAUDE.md` currently say that `bun run check` checks whether StyleX follows the Astryx peer dependency, but it only checks exact versions; after implementation the two agree.

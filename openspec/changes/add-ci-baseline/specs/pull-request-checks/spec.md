# Spec Delta

## Purpose

Specify which checks every pull request must pass before it merges, so that `main` can always build and pass its tests, and CI and local runs use the same commands.

## ADDED Requirements

### Requirement: Quality checks are required
Every pull request that targets `main` MUST pass all checks that the single check command covers. When any one of them fails, the pull request MUST NOT be merged.

#### Scenario: Check fails (needs a real repository, manual verification)
- **WHEN** a pull request contains a type error
- **THEN** CI fails, the log names the failed check, and the pull request cannot be merged

#### Scenario: Checks pass (needs a real repository, manual verification)
- **WHEN** all required checks of a pull request pass
- **THEN** the pull request can be merged

### Requirement: Reproducible dependency install
CI MUST install dependencies strictly from the lockfile, and MUST fail when the lockfile and the dependency declarations disagree.

#### Scenario: Stale lockfile (needs a real repository, manual verification)
- **WHEN** a pull request changes the dependency declarations but does not update the lockfile
- **THEN** the install step fails and the later checks do not run

### Requirement: Compatibility tests are required
Every pull request MUST run the compatibility tests on the Workers runtime and on Bun, and run the browser tests against the production build. These tests MUST NOT depend on a cloud account.

#### Scenario: No cloud credentials (needs a real repository, manual verification)
- **WHEN** CI runs the compatibility test command in an environment without Cloudflare credentials
- **THEN** all local cases run, the cases that need a real deployment show as skipped, and the command exits with status 0

#### Scenario: Runtime incompatibility (needs a real repository, manual verification)
- **WHEN** a pull request makes a route behave differently on Bun than on Workers, and a compatibility test covers that behavior
- **THEN** CI fails and the pull request cannot be merged

### Requirement: Type-aware lint
The lint in CI MUST include rules that depend on type information and check each file against the type environment of the runtime it belongs to.

#### Scenario: Unhandled Promise
- **WHEN** Bun code contains a Promise that is neither awaited nor handled
- **THEN** lint fails and names that line

#### Scenario: File compiled only under Workers
- **WHEN** a file that belongs only to the Workers type environment contains an unhandled Promise
- **THEN** lint fails and names that line, with no other errors caused by missing type information

### Requirement: Dependency vulnerability scan
Every pull request MUST scan all dependencies that the lockfile resolves, including transitive dependencies. The scan MUST fail and name the dependency and the vulnerability ID when it finds a known vulnerability, unless an exception with a recorded reason covers it and has not expired.

#### Scenario: Dependency with a known vulnerability introduced (needs a real repository, manual verification)
- **WHEN** a pull request changes a dependency to a version with a published vulnerability
- **THEN** the scan fails and the log contains the dependency name and the vulnerability ID

#### Scenario: Vulnerability with a registered exception
- **WHEN** a vulnerability in the lockfile is registered in the scan configuration with a reason and an expiry date, and the date has not passed
- **THEN** the scan passes

#### Scenario: Exception expires
- **WHEN** the registered expiry date has passed
- **THEN** the scan fails again

### Requirement: Secret leak scan
Every pull request MUST scan the commits it adds, and MUST fail when it finds a suspected credential. Content explicitly marked as a test fixture MUST NOT cause a failure.

#### Scenario: Credential in a commit (needs a real repository, manual verification)
- **WHEN** a commit in a pull request contains a string that looks like a cloud service secret
- **THEN** the scan fails, the log names the commit and the file, and the full secret is not printed

#### Scenario: Test fixture
- **WHEN** the repository contains only test fixtures that are on the allowlist
- **THEN** the scan passes

### Requirement: Static security analysis
Every pull request MUST run static security analysis on the TypeScript code. High-severity issues found by the analysis MUST block merging.

#### Scenario: High-severity issue introduced (needs a real repository, manual verification)
- **WHEN** a pull request introduces code that the analysis tool rates as high-severity
- **THEN** the pull request cannot be merged

### Requirement: Coverage is reported without a threshold
CI SHALL report test coverage in a required job. The level of coverage and changes in it MUST NOT fail that job or block merging.

#### Scenario: Coverage drops (needs a real repository, manual verification)
- **WHEN** a pull request lowers coverage
- **THEN** CI reports the new coverage, the coverage job passes, and the pull request can still be merged

### Requirement: Local reproduction
The quality checks and the compatibility tests in CI MUST call the same commands that contributors run locally.

#### Scenario: Failure reproduced locally (needs a real repository, manual verification)
- **WHEN** a contributor runs locally the command that failed in the CI log
- **THEN** the same check fails

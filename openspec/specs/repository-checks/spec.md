# repository-checks Specification

## Purpose
This spec lets contributors confirm code quality and build status locally with a single command. CI added later reuses the same entry point, so local and CI checks stay consistent.

## Requirements

### Requirement: Single check command
The repository SHALL provide one command at the repository root that runs lint, format check, typecheck, unit tests and the production builds of all apps. When any of these fails, the command MUST exit with a non-zero status.

#### Scenario: All checks pass
- **WHEN** a contributor installs dependencies in a clean checkout and runs the single check command
- **THEN** the command runs every check and exits with status 0

#### Scenario: One check fails
- **WHEN** the code has a type error and a contributor runs the single check command
- **THEN** the command exits with a non-zero status and names the failed check in its output

### Requirement: Reproducible dependency versions
The repository MUST commit a dependency lockfile and pin the design system and its style compilation dependencies to exact versions.

#### Scenario: Install from the lockfile
- **WHEN** a contributor installs dependencies with the lockfile frozen
- **THEN** the install succeeds and the lockfile does not change

#### Scenario: Design system version pinned
- **WHEN** a script checks the dependency declarations in the root and in each workspace
- **THEN** the design system and its style compilation dependencies are all declared with exact versions, without `^` or `~`

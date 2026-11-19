# Spec Delta

## MODIFIED Requirements

### Requirement: Single check command
The repository SHALL provide one command at the repository root that runs lint, format check, typecheck, unit tests, the proof checks of the laws, the check that compiled modules match their source, the requirement coverage check and the production builds of all apps. When any of these fails, the command MUST exit with a non-zero status.

#### Scenario: All checks pass
- **WHEN** a contributor installs dependencies and the pinned Bend toolchain in a clean checkout and runs the single check command
- **THEN** the command runs every check and exits with status 0

#### Scenario: One check fails
- **WHEN** the code has a type error and a contributor runs the single check command
- **THEN** the command exits with a non-zero status and names the failed check in its output

## ADDED Requirements

### Requirement: Every scenario has a test
The single check command SHALL fail when a scenario in `openspec/specs` has no test that carries the scenario's name, which is its ID: a test whose own name is the scenario's name, or the scenario's name followed by `:` and more. A scenario that a list in the repository records as verified on a real deployment, on GitHub or by hand, with how, SHALL pass without a test. No two scenarios in `openspec/specs` SHALL share a name.

#### Scenario: A scenario without a test
- **WHEN** a spec in `openspec/specs` holds the scenario `Replacing a file`, the only test near that name is `Replacing a file twice`, and a contributor runs the single check command
- **THEN** the command fails and names the spec and the scenario

#### Scenario: A scenario verified by hand
- **WHEN** a scenario has no test, the list records that it is verified by hand and how, and a contributor runs the single check command
- **THEN** the command passes and reports that scenario as verified by hand

#### Scenario: Two scenarios with one name
- **WHEN** two scenarios in `openspec/specs` share a name and a contributor runs the single check command
- **THEN** the command fails and names both specs

### Requirement: Weekly mutation testing
A scheduled CI run SHALL mutation-test `packages/core` and `packages/webdav` once a week and whenever a maintainer starts it by hand, each package on its own, and SHALL fail when either package's mutation score is below 80%. One command SHALL run the same mutation tests locally.

#### Scenario: A mutation score below the threshold
- **WHEN** the mutation run finds that a package's mutation score is below 80%
- **THEN** the run fails and names the package and its score

#### Scenario: Mutation testing by hand
- **WHEN** a maintainer starts the mutation workflow by hand
- **THEN** it runs the same mutation tests as the weekly run

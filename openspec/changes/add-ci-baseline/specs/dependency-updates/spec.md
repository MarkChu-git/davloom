# Spec Delta

## Purpose

Keep dependencies at the exact version that the npm `latest` tag points to, put each new version into the update flow as soon as it is published, and give transitive dependencies and known vulnerabilities a set way of being handled.

## ADDED Requirements

### Requirement: Automatic dependency update proposals
Once the npm `latest` tag of a dependency points to a new version, the project SHALL create a pull request that updates it on the next automatic run, with no waiting period after release. The updated version specifier MUST remain an exact version, and pre-release tags MUST NOT count as new versions.

#### Scenario: Newly published latest version (needs a real repository, manual verification)
- **WHEN** a dependency has just published a new version and the npm `latest` tag already points to it
- **THEN** after the next automatic run a pull request that updates it appears, its version specifier is an exact version, and the single check command passes

### Requirement: Security fixes for direct dependencies
When a direct dependency has a published vulnerability and a fixed version exists, the project SHALL create a pull request that upgrades it to the fixed version.

#### Scenario: Vulnerability with a fixed version (needs a real repository, manual verification)
- **WHEN** a direct dependency has a published vulnerability and the fixed version is already released
- **THEN** a pull request that upgrades to the fixed version appears and states which vulnerability it fixes

### Requirement: Design system dependencies stay consistent
All Astryx packages MUST be upgraded to the same version in the same pull request. The installed StyleX version MUST satisfy the peer dependency range that Astryx declares, and the single check command MUST fail when it does not.

#### Scenario: Astryx publishes a new version (needs a real repository, manual verification)
- **WHEN** Astryx publishes a new version
- **THEN** only one pull request updates Astryx, and all Astryx packages in it are at the same version

#### Scenario: StyleX outside the range Astryx requires
- **WHEN** the installed StyleX version is outside the peer dependency range declared by Astryx
- **THEN** the single check command fails, and the error message gives the range Astryx requires and the installed version

#### Scenario: StyleX publishes an out-of-range version (needs a real repository, manual verification)
- **WHEN** StyleX publishes a new version that is outside the Astryx peer dependency range
- **THEN** no pull request that upgrades StyleX appears

### Requirement: Periodic refresh of transitive dependencies
The project SHALL refresh the lockfile periodically so that transitive dependencies also receive fixes.

#### Scenario: Periodic refresh (needs a real repository, manual verification)
- **WHEN** the refresh period has arrived and a transitive dependency in the lockfile has a new version
- **THEN** a pull request that changes only the lockfile appears

### Requirement: New vulnerabilities in existing dependencies
The project SHALL scan the lockfile on `main` periodically, so that newly published vulnerabilities are found even when there is no pull request.

#### Scenario: New vulnerability published (needs a real repository, manual verification)
- **WHEN** a vulnerability is newly published for a dependency already on `main`
- **THEN** the next scheduled scan fails and names the dependency and the vulnerability ID

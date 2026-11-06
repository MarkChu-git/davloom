# Spec Delta

## Purpose

Protect the `main` branch so that every change goes through a pull request and the required checks, without letting approval rules block a project that has a single maintainer.

## ADDED Requirements

### Requirement: Only pull requests that pass checks reach main
`main` MUST reject direct pushes, force pushes and deletion. A pull request MUST pass all required checks before it can be merged.

#### Scenario: Direct push (needs a real repository, manual verification)
- **WHEN** someone pushes a commit directly to `main`
- **THEN** the push is rejected

#### Scenario: Force push (needs a real repository, manual verification)
- **WHEN** someone force-pushes `main`
- **THEN** the push is rejected

### Requirement: No required approval with a single maintainer
With only one maintainer, `main` MUST NOT require approval from anyone else. The project SHALL name the owner of each directory.

#### Scenario: Maintainer merges their own pull request (needs a real repository, manual verification)
- **WHEN** the only maintainer submits a pull request and all required checks pass
- **THEN** it can be merged without anyone else's approval

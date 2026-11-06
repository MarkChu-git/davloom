# Spec Delta

## Purpose

Protect the `main` branch so that every change goes through a pull request and passes every required check, and so that a change from anyone other than the repository owner gets two approvals.

## ADDED Requirements

### Requirement: Only pull requests that pass checks reach main
`main` MUST reject direct pushes, force pushes and deletion. A pull request MUST pass all required checks before it can be merged. These rules MUST apply to everyone, the repository owner included.

#### Scenario: Direct push (needs a real repository, manual verification)
- **WHEN** someone pushes a commit directly to `main`
- **THEN** the push is rejected

#### Scenario: Force push (needs a real repository, manual verification)
- **WHEN** someone force-pushes `main`
- **THEN** the push is rejected

#### Scenario: Owner with a failing check (needs a real repository, manual verification)
- **WHEN** a required check fails on the repository owner's pull request
- **THEN** the owner cannot merge it

### Requirement: Two approvals unless the owner merges
A pull request into `main` MUST have two approvals before it can be merged, and pushing new commits MUST dismiss the approvals given before. The repository owner SHALL be able to merge their own pull request without approvals once all required checks pass. The project SHALL name the owner of each directory.

#### Scenario: Owner merges their own pull request (needs a real repository, manual verification)
- **WHEN** the repository owner opens a pull request and all required checks pass
- **THEN** the owner can merge it without approvals

#### Scenario: Another author needs two approvals (needs a real repository, manual verification)
- **WHEN** someone other than the owner opens a pull request and all required checks pass
- **THEN** it cannot be merged until two reviewers approve it

#### Scenario: New commits dismiss approvals (needs a real repository, manual verification)
- **WHEN** new commits are pushed to a pull request that has two approvals
- **THEN** the approvals are dismissed and two new ones are needed

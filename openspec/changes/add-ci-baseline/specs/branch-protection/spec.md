# Spec Delta

## Purpose

Protect the `main` branch so that every change goes through a pull request and passes every required check, and so that anyone other than the repository owner needs two approvals to merge.

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
Anyone other than the repository owner MUST NOT be able to merge a pull request into `main` until it has two approvals, and pushing new commits MUST dismiss the approvals given before. The owner SHALL be able to merge any pull request without approvals once all required checks pass. The project SHALL name the owner of each directory.

#### Scenario: Owner merges without approvals (needs a real repository, manual verification)
- **WHEN** all required checks pass on a pull request, whether the owner, a fork or Renovate opened it
- **THEN** the repository owner can merge it without approvals

#### Scenario: Anyone else needs two approvals (needs a real repository, manual verification)
- **WHEN** someone other than the owner tries to merge a pull request that has fewer than two approvals
- **THEN** the merge is blocked until two reviewers approve it

#### Scenario: New commits dismiss approvals (needs a real repository, manual verification)
- **WHEN** new commits are pushed to a pull request that has two approvals
- **THEN** the approvals are dismissed and two new ones are needed

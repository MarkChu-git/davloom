# Spec Delta

## Purpose

Prevent CI itself from becoming an entry point for supply chain attacks: third-party actions, overly broad token permissions and untrusted pull requests must not be able to get write access to the repository or its secrets.

## ADDED Requirements

### Requirement: Third-party actions pinned to a commit
Every action that a workflow references MUST be pinned to a full commit SHA, and MUST NOT use a mutable tag or branch.

#### Scenario: Mutable tag
- **WHEN** a pull request references an action by tag in a workflow
- **THEN** the workflow check fails and names that line

### Requirement: Minimal token permissions
Every workflow MUST declare `permissions` explicitly, read-only by default. A job that needs more permissions MUST declare them on its own, and declare only the permissions it uses.

#### Scenario: Permissions not declared
- **WHEN** a pull request adds a workflow that does not declare `permissions`
- **THEN** the workflow check fails

### Requirement: No privileged triggers
A workflow MUST NOT use the `pull_request_target` trigger.

#### Scenario: Privileged trigger used
- **WHEN** a pull request adds a workflow triggered by `pull_request_target`
- **THEN** the workflow check fails

### Requirement: Pull request checks do not touch secrets
Pull request checks MUST NOT read cloud credentials or repository secrets, and a pull request from a fork MUST get the same check results as a branch inside the repository.

#### Scenario: Pull request from a fork (needs a real repository, manual verification)
- **WHEN** an outside contributor opens a pull request from a fork
- **THEN** all required checks run, and the results are not affected by the missing secrets

### Requirement: Workflow files are checked
Every pull request that changes a workflow file MUST pass a syntax check and a security check.

#### Scenario: Workflow syntax error
- **WHEN** a pull request contains a workflow file with a syntax error
- **THEN** the workflow check fails and names the location of the error

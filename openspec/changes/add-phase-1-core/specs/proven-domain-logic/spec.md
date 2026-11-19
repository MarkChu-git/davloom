# Spec Delta

## Purpose

Makes every rule that decides an outcome without IO proven as well as tested: its laws are stated in Bend 2 and approved by the owner, two checkers prove them, and the code that runs is compiled from the code that was proven.

## ADDED Requirements

### Requirement: Both checkers prove every law
The repository's checks SHALL fail unless `bend PROOF.bend` and `bend PROOF.bend --verdict` both print ALL PROOFS CHECK with the pinned Bend release. A law without a proof, a false law, and a proof that relies on `@unsafe` or foreign code SHALL each make them fail.

#### Scenario: An open law
- **WHEN** a law in `LAWS.bend` has no proof in `PROOF.bend` and a contributor runs the single check command
- **THEN** the command fails and names the law

#### Scenario: A proof that relies on unsafe code
- **WHEN** a proof calls a def marked `@unsafe` and a contributor runs the single check command
- **THEN** the `--verdict` check fails, and the command fails with it

### Requirement: Laws state their own meaning
Every predicate that a law in `LAWS.bend` uses SHALL be defined in `LAWS.bend`, and `LAWS.bend` SHALL import only `Base`, Bend's standard library, and the shipped modules. A law SHALL reach a shipped module only through the functions that the module's TypeScript wrapper calls, so the code can change under its proofs while what the laws mean changes only with the owner's approval.

#### Scenario: A predicate outside the laws
- **WHEN** a law in `LAWS.bend` uses a def of a shipped module that the module's wrapper does not call, and a contributor runs the single check command
- **THEN** the command fails and names the law and the def

#### Scenario: A helper module under the laws
- **WHEN** `LAWS.bend` imports a Bend file that is neither `Base` nor a shipped module, and a contributor runs the single check command
- **THEN** the command fails and names the import

### Requirement: A pinned toolchain
The Bend release, and the Lean release that builds its `--verdict` kernel, SHALL be pinned in the repository with the SHA-256 of each archive, and SHALL install without Node. An archive whose SHA-256 differs from the pinned one SHALL be refused.

#### Scenario: A tampered archive
- **WHEN** the setup script downloads a Bend archive whose SHA-256 differs from the pinned one
- **THEN** it stops with an error that names the archive, and installs nothing

### Requirement: Compiled modules match their source
Each compiled JavaScript module in the repository SHALL equal what the pinned Bend release compiles from its source, and the Bend source of a module that TypeScript calls SHALL import no foreign code.

#### Scenario: A stale compiled module
- **WHEN** a contributor changes a Bend source without compiling it again and runs the single check command
- **THEN** the command fails and names the module that differs from its source

#### Scenario: Foreign code in a shipped module
- **WHEN** a Bend module that TypeScript calls imports a JavaScript or C file
- **THEN** the single check command fails and names the import

### Requirement: Laws checked on the compiled module
Every law in `LAWS.bend` SHALL have a property test that checks it against the compiled JavaScript module, and the checks SHALL fail when a law has none.

#### Scenario: A law without a property test
- **WHEN** a law is added to `LAWS.bend` without a property test that carries its name, and a contributor runs the single check command
- **THEN** the command fails and names the law

### Requirement: A typed boundary
TypeScript SHALL call a compiled module only through a wrapper that declares its types, copies any array the caller keeps, refuses with a typed error any number that Bend cannot hold before calling the module, and turns any error that Bend throws into a typed error.

#### Scenario: A number Bend cannot hold
- **WHEN** a caller passes a wrapper a number above 2^48 − 1 where the module takes a Nat
- **THEN** the wrapper fails with a typed error and does not call the module

### Requirement: The owner approves every change to the laws
A required check SHALL fail on every pull request that changes `packages/laws/LAWS.bend`, or the workflow, script or root `bunfig.toml` the check runs with, until the owner adds the `laws-approved` label after the pull request's last commit, as GitHub's records show. A label that another account adds, or that a later commit follows, SHALL not count. The check runs the pull request's own copy of these files, so a pull request that removes the guard from that copy is not held by it.

#### Scenario: A law change without approval
- **WHEN** a pull request changes `packages/laws/LAWS.bend` and carries no `laws-approved` label
- **THEN** the approval check fails

#### Scenario: The owner's approval
- **WHEN** the owner adds `laws-approved` to a pull request that changes `packages/laws/LAWS.bend`, and a commit is pushed to it afterwards
- **THEN** the approval check passes after the label is added, and fails again after the commit

#### Scenario: A label from another account
- **WHEN** an account other than the owner's adds `laws-approved` to a pull request that changes `packages/laws/LAWS.bend`
- **THEN** the approval check still fails

#### Scenario: A pull request that changes the check
- **WHEN** a pull request without the label changes the approval check's script, and keeps the script's list of guarded files
- **THEN** the approval check fails

#### Scenario: A pull request that leaves the laws alone
- **WHEN** a pull request changes other files, the `LAWS.bend` of a test fixture among them, and neither `packages/laws/LAWS.bend` nor the approval check
- **THEN** the approval check passes without the label

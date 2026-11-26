# Spec Delta

## Purpose

Specify which Cloudflare CLI the project's scripts use for each kind of cloud operation, how they run it, and how a cloud run stays within one account, so that every run is reproducible on Bun and touches only what it created.

## ADDED Requirements

### Requirement: Account operations use cf
Scripts SHALL perform every Cloudflare account operation through the cf CLI, except bundling, uploading or deploying Worker code and streaming a Worker's invocation events. Account operations include creating, finding and deleting D1 databases, applying D1 migrations to a remote database, finding and deleting Workers, and listing Durable Object namespaces.

#### Scenario: Probe flow calls
- **WHEN** the Cloud Free probe flow runs its deploy and destroy steps against a command runner that records every call and returns prepared responses
- **THEN** every recorded call is a cf call, except the Wrangler calls that deploy Worker code and the calls that check a tool's version

#### Scenario: Migrations reach the database the run created
- **WHEN** the probe flow has created its D1 test database and applies the repository's D1 migrations
- **THEN** it identifies the target by the ID of the database it created, and applies the migrations to no other database

#### Scenario: Lookups match names exactly
- **WHEN** a cf lookup by name returns resources whose names contain the probe's name but differ from it
- **THEN** the flow ignores them, and when no resource or more than one resource has exactly that name, it deletes nothing through that lookup and reports how many matched

#### Scenario: cf accepts every call the flow builds
- **WHEN** every argument list that the probe flow builds for cf runs through the pinned cf with `--dry-run` and no credentials
- **THEN** cf accepts each one and exits with status 0

### Requirement: Cloudflare tools run on Bun without telemetry
Every cf and Wrangler call that the Cloud Free probe flow starts MUST run on Bun from the package that declares the tool, and MUST NOT start Node. Each of these calls MUST set `CF_SEND_TELEMETRY=false`, `WRANGLER_SEND_METRICS=false` and `DO_NOT_TRACK=1`. Before its first account call, each step of the flow MUST check that every tool it calls reports the version that package pins, and MUST stop otherwise.

#### Scenario: How the probe flow starts a tool
- **WHEN** the probe flow starts cf or Wrangler through its command runner
- **THEN** the command runs the tool with `bunx --bun --no-install` in the compatibility test package, and its environment sets the three variables

#### Scenario: A tool other than the pinned copy answers
- **WHEN** a step of the probe flow starts and cf or Wrangler, started the way the flow starts it, reports a version other than the one the compatibility test package pins
- **THEN** the step exits with a non-zero status and names both versions before it makes any account call or writes a state file

#### Scenario: A cloud run makes no Node call (requires a real deployment)
- **WHEN** `cloud:free all` runs with a logging `node` first on `PATH`
- **THEN** the run exits with status 0 and the log records no call

### Requirement: One account per cloud run
A script that changes or measures Cloudflare resources MUST refuse to start unless `CLOUDFLARE_ACCOUNT_ID` is set, and MUST pass that account to every cf and Wrangler call it makes, so that a run creates, measures and deletes its resources in one account.

#### Scenario: Account not set
- **WHEN** any step of the Cloud Free probe flow starts without `CLOUDFLARE_ACCOUNT_ID`
- **THEN** it exits with a non-zero status and names the variable before it calls cf or Wrangler and before it writes a state file

#### Scenario: Account passed to every call
- **WHEN** the probe flow runs its deploy, measure and destroy steps against a recording command runner with `CLOUDFLARE_ACCOUNT_ID` set
- **THEN** every recorded call, including the one that starts the measurements, receives that same `CLOUDFLARE_ACCOUNT_ID`

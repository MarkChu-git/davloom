# Proposal

## Why

Davloom cannot store a file yet. `packages/webdav` answers 501, `packages/core` holds only the HTTP runner, and the database holds only Better Auth's tables. Phase 2 builds WebDAV on a storage layer, and PRD §13 puts that layer in Phase 1: Effect Core, D1/SQLite and Durable Objects/R2/S3. PRD §4 also starts Proven Domain Logic in Phase 1, so the file tree that every backend presents is stated as Bend 2 laws and proven before the backends ship.

On 2026-11-19 the owner asked for the smallest Phase 1 the PRD allows, and decided that each Durable Objects backend is a single Durable Object, which holds at most 1 GB on Workers Free.

## What Changes

- Add `packages/laws` with a pinned Bend release and the Lean release that its `--verdict` kernel builds with. Its namespace model is a file tree of entries with parents, under creating, writing, removing, copying and moving. Its laws say that every operation keeps the tree valid: every entry except the root has a parent collection, a collection holds at most one entry per name, and no operation creates a cycle. Further laws say that the model accepts exactly the valid paths and decides every outcome in the order the spec states. Two smaller modules map paths to object keys and check backend fields, each with laws of its own. TypeScript calls the compiled modules through typed wrappers.
- Add the Storage Port to `packages/core`, and two adapters in a new `packages/storage`: Durable Objects, the Cloud Free default, with one object per backend; and an object-store adapter with an R2 driver, through the Workers binding, and an S3 driver, through the AWS SDK. One contract suite checks every adapter against the namespace model, on each runtime that the adapter supports.
- Add the `storage_backends` table to `packages/database`. D1 and Bun SQLite pass the same contract tests, and an upgrade test starts from the Phase 0 schema. Backend credentials are stored encrypted.
- Add an Effect service that saves, lists, removes and opens storage backends, and the Layers that provide it on Workers and on Bun.
- Add the Phase 1 checks. `bun run check` gains the proof checks, a rebuild check of the compiled modules, a check that the laws keep their meaning in `LAWS.bend`, the property tests of the laws and a requirement coverage check. A required check holds a pull request that changes `LAWS.bend` or the check itself until the owner adds `laws-approved`, unless the pull request rewrites the check's guard, which the independent review has to catch. CI gains a storage contract job, a database contract job and a weekly mutation run on `packages/core` and `packages/webdav`.
- Out of scope: WebDAV methods, routes that reach storage, Mounts and the other Davloom tables, editing a saved backend, the synchronous limit for directory COPY/MOVE, uploads of unknown length, recovery from a failure in the middle of a multi-object operation, and conflict checks for concurrent writers on R2 and S3. Each arrives with the phase whose laws or features need it.

## Capabilities

### New Capabilities

- `storage-namespace`: the file tree every storage backend presents, its operations and errors, and the laws it keeps.
- `storage-backends`: configuring Durable Objects, R2 and S3-compatible backends, protecting their credentials, presenting buckets as trees, and reaching each backend from the runtimes that support it.
- `instance-database`: Davloom's own tables on D1 and Bun SQLite, with the same behavior on both and upgrades that keep existing data.
- `proven-domain-logic`: how laws are stated, approved, proven, compiled and checked.

### Modified Capabilities

- `repository-checks`: the single check command also runs the proof checks and the requirement coverage check, and a weekly mutation run is added.

## Impact

- New workspaces: `packages/laws`, `packages/storage` and `tests/contracts`.
- Changed packages: `packages/core` gains the Storage Port, its errors and the storage backend service; `packages/database` gains the `storage_backends` table and migration `0001`; `packages/webdav` gains a unit test of its 501 handler.
- New dependencies, at the npm `latest` versions of 2026-11-19: `@aws-sdk/client-s3` 3.1172.0, `fast-check` 4.10.3, `testcontainers` 12.2.1, `@vitest/istanbul-lib-coverage` 2.1.0, and `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` 10.1.1. Outside npm: Bend 2.0.40, Lean 4.34.0 and the `rustfs/rustfs` 1.0.6 image.
- CI gains a Bend setup and a laws step in `check`, two contract jobs, a `laws-approval` workflow and a weekly mutation workflow. Running `bun run check` locally now needs Bend and its kernel, which `bun run laws:setup` installs.
- Phase 0's tests are renamed so that each starts with the name of the scenario it covers. One scenario of `openspec/specs/dashboard-overview` is renamed in place, from "The sample backends" to "Bytes of the sample backends", with its test, because Storage & Mounts has a scenario of the same name and the requirement coverage check needs every name to be unique. The behavior does not change.
- The production entries behave as before: `/dav/*` still answers 501, and nothing new is deployed to Cloudflare.

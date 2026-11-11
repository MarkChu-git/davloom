# Proposal

## Why

On 2026-11-07 the maintainer chose Cloudflare's `cf` CLI over Wrangler, and no change tracks that decision yet. A check of cf 1.0.0-beta.29, the release on the npm `latest` tag, shows that only part of the move fits the rule that everything runs on Bun. cf's account commands run on Bun, but `cf build`, `cf deploy` and `cf dev` hand off to Wrangler, which refuses to load `cloudflare.config.ts` on Bun and works only when cf starts it on Node. This change moves the part that works now, records why the rest stays on Wrangler, and names the check that decides when it can move.

## What Changes

- The Cloud Free probe flow (`tests/integration/compat/scripts/cloud-free.ts`) manages the account's resources with cf instead of Wrangler. It creates, finds and deletes the D1 test database, applies the remote D1 migrations by database ID, looks for and deletes the probe Worker, and lists Durable Object namespaces. Lookups by name keep only exact matches, because the account also holds unrelated databases and Workers.
- The cleanup check lists Workers, Durable Object namespaces and D1 databases, and a listing that fails stops it with an error. Right after creating the database and right after uploading the Worker, the flow checks, retrying as the cleanup does, that each listing shows what it created, and records the result. The cleanup then counts a resource as gone only when a listing that showed it no longer does. Today a failing `wrangler deployments list` counts as proof that the Worker is gone, and the Durable Object namespace is judged only by the exit status of the tombstone deploy, because Wrangler cannot list namespaces.
- The flow refuses to start unless `CLOUDFLARE_ACCOUNT_ID` names the account. cf and Wrangler sign in separately, so without it the database and the Worker could land in different accounts.
- Wrangler keeps three jobs: bundling (`wrangler deploy --dry-run` in the `apps/api` build and in the local test harness), deploying the probe (including the tombstone deploy that deletes its Durable Object data), and `wrangler tail`. Both Workers keep `wrangler.jsonc`. Local tests, Playwright and `dev:workers` keep starting workerd through Miniflare, as task 2.1 of `add-ci-baseline` (PR #10) sets up.
- `cf` becomes an exact dev dependency of `@davloom/compat-tests`, and every cf call goes through one module that an offline `--dry-run` test checks against the pinned cf. cf and Wrangler run as `bunx --bun --no-install` from that package, and each step first checks that the tools it calls report the pinned versions, because `bunx` otherwise falls back to any copy on `PATH`. Wrangler, in `apps/api` and in `@davloom/compat-tests`, and `@cloudflare/vitest-plugin` move to their `latest` versions, which pin the same Miniflare as cf, and the direct `miniflare` dependency follows them.
- Docs: `AGENTS.md` and `CLAUDE.md` say how to run cf on Bun and which cf commands to avoid; a new `docs/development/cloudflare-cli.md` records which tool does what and how to check a new cf release; `prd.md` names cf in §2 and in the release row of §11; Decision 3 and task 6.1 of `add-ci-baseline` put the Cloudflare packages in one Renovate group.

Not included: moving bundling, deploying or live tail to cf, migrating either Worker config to `cloudflare.config.ts`, and any change to the Workers or Bun runtime code. A later change does that once a cf release passes the check in Decision 8 of design.md. Running `cloud:free` needs the maintainer's approval, so it is the last task.

## Capabilities

### New Capabilities

- `cloudflare-tooling`: Which Cloudflare CLI the project's scripts use for which operations, how they run it (on Bun, with no Node call and with telemetry off), and how one cloud run stays in one account.

### Modified Capabilities

- `runtime-compatibility-checks`: "Probe entry isolation" now requires the cleanup to be confirmed by listing Workers, Durable Object namespaces and D1 databases, and a failed listing to stop the cleanup instead of counting as absence. Two new requirements make the flow check each listing against what it created, and count a resource as gone only through a listing that showed it.

## Impact

- Code: `tests/integration/compat/scripts/cloud-free.ts` becomes a thin entry over a flow module that takes its command runner, `fetch` and sleep function as parameters; a new `tests/integration/compat/cloud/cf.ts` wraps the cf calls; new unit tests sit next to them. `apps/api/package.json` (the Wrangler version and the telemetry variables of `build`), `tests/integration/compat/package.json`, `bun.lock`, `tests/integration/compat/cloud/tail.ts` and a comment in `packages/database/src/bun-sqlite.ts` change.
- Dependencies: `cf` 1.0.0-beta.29, whose `latest` tag points to this beta; Wrangler 4.160.0, `@cloudflare/vitest-plugin` 1.7.0 and `miniflare` 5.20261110.0-beta. If newer versions are on `latest` when the change is implemented, it takes those.
- External systems: a `cloud:free` run needs cf signed in (`cf auth login`) besides Wrangler, or one `CLOUDFLARE_API_TOKEN` for both, plus `CLOUDFLARE_ACCOUNT_ID`. CI reads no Cloudflare credentials; it runs cf only offline, with `--dry-run`.
- Prerequisites: PR #10 is merged, because this change builds on its Miniflare harness and edits the same `package.json`.
- Decisions for the maintainer: the "Maintainer review" section of design.md asks four questions: whether to accept the split between cf and Wrangler that the Bun-only rule forces, whether a beta that the `latest` tag points to needs a dependency exception, whether the newer `miniflare` beta is approved, and whether PRD §4 covers the probe flow's checks.

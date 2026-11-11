# Design

## Context

See proposal.md for the motivation and the specs for the required behavior.

Where Wrangler is used on `main` (checked on 2026-11-11):

| File | What Wrangler does there |
| --- | --- |
| `apps/api/wrangler.jsonc`, `tests/integration/compat/probe/wrangler.jsonc` | Worker configs: name, entry, compatibility date, bindings, static assets |
| `apps/api/package.json` | `build` bundles the Worker with `wrangler deploy --dry-run --outdir dist/workers`; `dev:workers` runs `wrangler dev` |
| `tests/integration/compat/http/servers.ts`, `playwright.config.ts`, `vitest.http.config.ts` | Local tests start workerd with `wrangler dev` and apply local D1 migrations with `wrangler d1 migrations apply --local` |
| `tests/integration/compat/scripts/cloud-free.ts` | `d1 create`, `d1 list --json`, `d1 migrations apply --remote`, `deploy` for the probe and for the tombstone, `delete`, `d1 delete`, `deployments list` |
| `tests/integration/compat/cloud/tail.ts` | `wrangler tail --format json`, the only source of per-request CPU time |
| `AGENTS.md`, `CLAUDE.md`, `prd.md` §11 | The `cloud:free` command line and the release row of the rollout plan |

`apps/api` and `@davloom/compat-tests` both declare `wrangler` 4.158.0. Comments in `packages/database/src/bun-sqlite.ts`, `.gitignore` (`.wrangler/`) and `oxlint.json` also name Wrangler. `docs/architecture/phase-0-findings.md` records how Phase 0 ran and stays as it is.

PR #10, which implements task 2.1 of `add-ci-baseline` and was still open on 2026-11-11, replaces the third row. `servers.ts` bundles each Worker with `wrangler deploy --dry-run`, starts workerd through Miniflare with the options that Wrangler's `unstable_getMiniflareWorkerOptions` derives from `wrangler.jsonc`, and applies the migrations through `getD1Database()`. Playwright and `dev:workers` start the same code through `scripts/serve-workers.ts`, and `miniflare` 5.20261104.0-beta becomes a dev dependency. It also starts Wrangler in `cloud-free.ts` and `cloud/tail.ts` as `bunx --bun wrangler`. Without `--bun`, as on `main`, `bunx` follows Wrangler's `#!/usr/bin/env node` line and runs it on Node. This design starts from that state.

cf was checked on 2026-11-11 at 1.0.0-beta.29, the release on the npm `latest` tag (published 2026-11-10), with Wrangler 4.160.0 as its bundler. The check ran in a scratch export of `main` with no Cloudflare credentials, telemetry off and a logging `node` first on `PATH`:

| Command | Result on Bun |
| --- | --- |
| `cf migrate --no-install <wrangler.jsonc>` | Works. Writes `cloudflare.config.ts` (`defineConfig` from `cf/config`) and, for the API Worker, `wrangler.config.ts` with the assets directory (`wrangler/experimental-config`). Leaves `wrangler.jsonc` in place. For the probe it leaves two TODOs: D1 `migrations_dir` has no equivalent, and cf must be installed in the package that owns the Worker |
| `cf build`, `cf deploy --dry-run`, `cf dev` | Not usable. cf hands each of them to Wrangler's `bin/cf-wrangler.js`, which needs `cloudflare.config.ts` ("cloudflare.config.ts is required when --experimental-new-config is enabled") and loads it through `@cloudflare/config` 0.31.1. That loader refuses Bun: "cloudflare.config.ts loading is not supported on Bun. Please use Node.js v22.18.0 or higher." cf starts the delegate by its file path, so the delegate's `#!/usr/bin/env node` line picks the first `node` on `PATH`. Under `bunx --bun cf`, that `node` points to Bun, and all three stop with that error. Under `bun --bun <cf bin>`, it is the real Node: `cf build` and `cf dev` then succeed but call Node, and with a `node` that exits 127 first on `PATH` they fail. `@cloudflare/vite-plugin` 2.0.0-beta.v.14 loads the config through the same package |
| `cf d1 migrations apply <id> --local` | Fails. Inside a migrated project it hits the config error above; elsewhere it reports "The local runtime failed to answer: ECONNREFUSED", because Miniflare's `dispatchFetch` routes through an undici dispatcher that Bun's `fetch` ignores |
| `cf deploy --prebuilt` | Does not load `cloudflare.config.ts`, but needs `.cloudflare/output/v0/config.json`, which only the delegated build writes |
| `cf d1 create`, `d1 list`, `d1 delete`, `d1 migrations apply <id> --dir <dir>`, `workers scripts search`, `workers delete`, `durable-objects namespaces list`, `accounts list` | Run under `bunx --bun --no-install cf` with no Node call. With `--dry-run` they print the API request they would send, except `d1 migrations apply`, which only validates its arguments. An unknown flag fails even with `--dry-run`. Their network calls have not run on Bun, because that needs an account |
| Live logs | No cf command streams invocation events. `cf o11y telemetry live-tail` only asks the API to prepare a WebSocket server |

Other facts from the same check:

- cf's `latest` tag points to 1.0.0-beta.29. The last version without a pre-release identifier is 0.15.0, published on 2026-09-25 shortly before 1.0.0-beta.0; it depends on `miniflare` 5.20260923.0-alpha.
- `bunx --bun --no-install cf` runs the copy installed in the working directory's package, and falls back to any `cf` on `PATH` when that package has none. In a package without cf, `cf --version` printed 1.0.0-beta.28, the global copy in `~/.bun/bin`; only with that directory off `PATH` did the call fail.
- On 2026-11-07, cf 1.0.0-beta.28 accepted Wrangler 4.136.0 or newer as its bundler; beta.29 needs 4.159.0 or newer. The `@cloudflare/config` 0.30.2 installed with beta.28 carries the same Bun check.
- cf reads credentials from `CLOUDFLARE_API_TOKEN`, then from its own OAuth profile (`cf auth login`); its code has no trace of Wrangler's login file. Both tools read `CLOUDFLARE_ACCOUNT_ID`. cf honors `CF_SEND_TELEMETRY`, `WRANGLER_SEND_METRICS` and `DO_NOT_TRACK`. It prints a result on stdout as JSON and writes a listing's `result_info` and its own messages to stderr; `CF_QUIET=1` turns off the progress display and `NO_COLOR=1` the colors.
- `cf d1 migrations apply` takes only a database ID, not a name or a binding. It records applied files in the same `d1_migrations` table as Wrangler and by default reads `<dir>/*.sql`, which matches `packages/database/drizzle`.
- Wrangler 4.160.0 uploads Workers through the scripts API (`/accounts/{account_id}/workers/scripts/{name}`). `cf workers list`, `cf workers get` and `cf workers delete` call the Workers API (`/accounts/{account_id}/workers/workers`), while `cf workers scripts search` searches the scripts API. Like `cf d1 list --name`, it returns partial matches as well as exact ones.
- cf 1.0.0-beta.29, Wrangler 4.160.0 and `@cloudflare/vitest-plugin` 1.7.0 all pin `miniflare` 5.20261110.0-beta. cf beta.28, Wrangler 4.158.0 and vitest-plugin 1.6.0 all pinned 5.20261104.0-beta. The `latest` tag of `miniflare` still points to 4.20260730.0.

## Goals / Non-Goals

**Goals:**

- Every account operation in the Cloud Free probe flow goes through cf, on Bun, with no Node call.
- Nothing that runs on Bun today starts to need Node, and the local tests and CI stay as PR #10 leaves them.
- The reason Wrangler stays, and the check that ends it, are written down where the next agent will look.

**Non-Goals:**

- Bundling, deploying or tailing with cf (Decision 2), and migrating the Worker configs to `cloudflare.config.ts`.
- Changing what the Cloud Free measurement measures. `wrangler tail` keeps missing events, as in Phase 0, where it received 6 of 100 API Key requests. Moving the CPU measurement to Workers Logs or a Tail Worker is a separate change.
- The Phase 6 release pipeline.

## Decisions

### 1. cf takes over the account's resources

| Operation | Wrangler today | cf after this change |
| --- | --- | --- |
| Look for an existing probe Worker | `wrangler deployments list --name davloom-probe`; any failure counts as "no Worker" | `cf workers scripts search --name davloom-probe`, every page, then an exact name match |
| Create the D1 test database | `wrangler d1 create <name>` | `cf d1 create --name <name>`; its JSON result carries the UUID |
| Find the database ID | `wrangler d1 list --json` | `cf d1 list --name <name>`, every page, then an exact name match; needed only when the create result was lost |
| Apply the migrations | `wrangler d1 migrations apply DB --remote --config <generated config>` | `cf d1 migrations apply <uuid> --dir ../../../packages/database/drizzle` |
| Delete the Worker | `wrangler delete davloom-probe --force` | `cf workers delete davloom-probe --force` |
| Delete the database | `wrangler d1 delete <name> --skip-confirmation` | `cf d1 delete <uuid> --force` |
| Confirm that the Durable Object namespace is gone | Nothing lists namespaces, so the exit status of the tombstone deploy decides | `cf durable-objects namespaces list`, every page, then a namespace whose script is the probe Worker |

Every cf and Wrangler call runs as `bunx --bun --no-install <tool> <args>` with the compat package as its working directory. `--bun` runs the tool's launcher, whose first line names Node, on Bun, and puts a `node` that points to Bun first on `PATH` for anything the tool starts, so no call can reach Node. `--no-install` stops `bunx` from downloading a tool, but a package without its own copy still gets whatever copy is on `PATH`, such as a global cf. So right after the account check of Decision 4, and before its first account call, each step runs `--version` the same way for every tool it calls, and stops with an error that names both versions when a tool differs from the version the compat package pins.

cf and Wrangler calls share one environment: `CF_SEND_TELEMETRY=false`, `WRANGLER_SEND_METRICS=false`, `DO_NOT_TRACK=1` and `CLOUDFLARE_ACCOUNT_ID` (Decision 4). cf calls add `CF_QUIET=1` and `NO_COLOR=1`, and Wrangler calls keep `CI=true`, which stops Wrangler from asking questions.

cf writes a listing's paging details to stderr and only its results to stdout. The flow reads pages with `--page` from 1 until a page comes back empty. It does not stop at a short page, because nothing has checked that every endpoint returns as many entries as `--per-page` asks for. A page that repeats the entries of the one before it, which an endpoint that ignores `--page` would return, ends the listing with an error, and so does a listing that reaches 50 pages. An endpoint that answers a page past the last one with an error makes the listing fail, which never counts as absence; task 6.1 records how each endpoint pages. A lookup by name keeps only exact matches, because cf also returns partial ones and the account holds unrelated databases and Workers. When no resource or several match exactly, the flow deletes nothing through that lookup and reports the count. Results are decoded with Effect Schema through `shared/json.ts`, so a changed output shape fails loudly instead of being misread.

Every cf call sits in one module, `cloud/cf.ts`. A unit test runs every argument list that the module builds through the pinned cf with `--dry-run`, offline and without credentials, using well-formed version 4 UUIDs. It first checks that `cf --version` reports the pinned version, so that a global cf cannot stand in for it. Because cf rejects unknown arguments even with `--dry-run`, an update that renames a command or a flag fails this test on its own pull request.

The state file gains the database ID, and `destroy` deletes by ID. When a run stopped between creating the database and recording its ID, `destroy` finds the ID by an exact name match. The database name stays random per run, as today.

Alternative: keep Wrangler for these operations and use cf only to list namespaces. That still needs cf and its sign-in, and leaves the maintainer's decision almost unimplemented, so it saves little.

### 2. Wrangler keeps bundling, deploying and live tail

cf hands `cf build`, `cf deploy` and `cf dev` to Wrangler's `cf-wrangler.js`, which needs `cloudflare.config.ts` and loads it through a loader that refuses Bun. Those commands work only when the delegate runs on Node, and nothing in the project may install, pin or call Node (Decision 7 of `add-ci-baseline`). So:

- `apps/api` keeps bundling its Worker with `wrangler deploy --dry-run --outdir dist/workers`, which `bun run check` runs. Its `build` script also sets the three telemetry variables, which it does not set today.
- The local harness from PR #10 keeps `wrangler deploy --dry-run` and Wrangler's config APIs.
- `cloud-free.ts` keeps `wrangler deploy --config <generated config>` for the probe and for the tombstone, and `cloud/tail.ts` keeps `wrangler tail`. Both already run as `bunx --bun wrangler` after PR #10, and gain `--no-install`, the version check and the shared environment from Decision 1.
- Both Workers keep `wrangler.jsonc`. Migrating them would not help, because Wrangler 4.160.0 cannot read `cloudflare.config.ts` on Bun either, and the harness reads the configs through Wrangler.

Wrangler would remain a dependency even after a full move, because cf hands bundling to Wrangler unless a project uses the Vite plugin.

Alternatives considered:

- Let cf's project commands run on Node. That reverses the Bun-only rule, which only the maintainer can do.
- Write the Build Output by hand and deploy it with `cf deploy --prebuilt`. `.cloudflare/output/v0` is an internal format of a beta, and Davloom would own a bundling pipeline that any cf release can break.
- Use `@cloudflare/vite-plugin` 2.0.0-beta.v.14 as cf's bundler. It loads the config through the same `@cloudflare/config` and fails the same way, and the `latest` tag does not point to it.
- Move nothing until cf builds on Bun. That keeps a single CLI, but leaves the namespace cleanup unconfirmed and gives the maintainer's decision no first step. The maintainer may still prefer it (see Maintainer review).

### 3. Miniflare stays the local runtime

Local tests, Playwright and `dev:workers` keep the Miniflare harness from PR #10. cf's `--local` commands start their own short-lived Miniflare and reach it through `dispatchFetch`, which fails on Bun, and inside a project they first need a config that they cannot load on Bun. Locally, cf runs only in the offline `--dry-run` test of Decision 1, so the `compat` job needs neither a cf sign-in nor an account.

### 4. One account per run

cf and Wrangler keep separate logins. If they resolve to different accounts, `deploy` would create the database in one and deploy a Worker bound to it in the other, and `destroy` could delete in an account the run never used. Every `cloud:free` step therefore refuses to start without `CLOUDFLARE_ACCOUNT_ID`, before its first call and before it writes the state file, and passes the variable to every cf and Wrangler call, including the Vitest run that starts `wrangler tail`. The maintainer signs in once with `cf auth login` next to the existing Wrangler login, or sets one `CLOUDFLARE_API_TOKEN` that both tools read.

Alternative: ask both tools for their accounts and go ahead when they agree. That adds calls that only a real account can test, and an explicit variable is easier to get right.

### 5. The cleanup is confirmed by listing

`destroy` keeps its order: the tombstone deploy, then the Worker, then the database. The tombstone deploy removes the Durable Object class from the code and declares it deleted, which is how Phase 0 deleted the stored data. `cf workers delete` describes itself as deleting a Worker "and all its associated resources", but nothing has checked what that means for namespaces, so the tombstone stays.

A listing proves that a resource is gone only if it would have shown the resource. `cf workers scripts search` searches the API that `wrangler deploy` uploads to, but no run has confirmed that it lists those Workers, and `cf workers delete` goes through the Workers API instead. The state file therefore records each resource before the call that creates it: the database name before `cf d1 create`, as today, and a marker before `wrangler deploy`. Right after `cf d1 create`, `deploy` checks that `cf d1 list --name` shows the database. Right after the upload, it checks that the scripts search shows the Worker and that the namespace listing shows its namespace. Each check retries six times at five-second intervals, as the cleanup does, because a listing can lag behind the change it should show. The flow records each result in the state file. When a listing misses its resource, `deploy` stops before measuring, and `all` still runs `destroy`.

`destroy` deploys the tombstone and deletes the Worker only when the state file shows that the upload started, and deletes the database by ID. It then confirms each resource that the run started to create, reading every page and retrying six times at five-second intervals, as today. A resource that a listing showed counts as gone once that listing no longer shows it, and a resource that no listing showed stays unconfirmed. A failing listing, a remaining resource and an unconfirmed resource each end `destroy` with an error that names them, and the state file stays. The maintainer then checks the account, deletes what is left and removes the state file by hand. An agent that runs the flow reports what is left and deletes nothing itself. The state file goes away on its own only when every resource the run started to create is confirmed gone. Task 6.1 records what the listings showed, and whether the namespace was already gone after the tombstone deploy.

### 6. The flow takes its dependencies as parameters

`scripts/cloud-free.ts` becomes a thin entry. The deploy, measure and destroy steps move into a module that receives a command runner, `fetch`, a sleep function, the environment and the paths. Unit tests give it a runner that records each call and returns prepared JSON, a `fetch` that answers the health check, and a sleep that returns at once, so no test polls a real address for up to two minutes or waits between cleanup retries. They cover the account and version checks, the shape of every cf and Wrangler call, pagination and its limits, exact name matches, the listing checks after creation and upload, the confirmation rules of Decision 5, and when the state file is written and removed. The tests live in `tests/integration/compat/cloud/` and run in `test:cloud:local` and `test:cloud`, so `bun run test:compat` and the `compat` job of `add-ci-baseline` run them without an account.

### 7. Dependencies

- `cf` joins the dev dependencies of `@davloom/compat-tests` at the exact version that its `latest` tag points to, 1.0.0-beta.29 today, which is a beta (see Maintainer review).
- `wrangler`, in both `apps/api` and `@davloom/compat-tests`, and `@cloudflare/vitest-plugin` move to their `latest` versions, 4.160.0 and 1.7.0 today, as the Dependencies rule asks anyway. Today these and cf all pin `miniflare` 5.20261110.0-beta, so the tree keeps one Miniflare and one workerd.
- The direct `miniflare` dependency that PR #10 adds follows the Miniflare that Wrangler pins, as PR #10 decided, so it moves from 5.20261104.0-beta to 5.20261110.0-beta. PR #10 asks the maintainer to approve that beta as an exception, and the new version needs the same approval.
- If the `latest` versions stop sharing one Miniflare, each package still takes its `latest` version, the direct `miniflare` follows Wrangler, and the change records which Miniflare each package brings.
- `add-ci-baseline` has not written `renovate.json` yet (task 6.1). Its Decision 3 and task 6.1 gain one group for `cf`, `wrangler`, `miniflare` and `@cloudflare/vitest-plugin`, so that one pull request moves them together.

### 8. When bundling and deploying can move

A later change moves bundling and deploying to cf once a cf release passes this check, run in a scratch export with no credentials, a logging `node` first on `PATH`, the release installed in each Worker package, and cf started as `bunx --bun --no-install cf` once `cf --version` shows that release:

1. `cf migrate --no-install` succeeds for both Worker configs.
2. `cf build` and `cf deploy --dry-run` finish for both Workers, and the log records no Node call.
3. `@cloudflare/config` loads both new configs on Bun, so the harness can read them.

`docs/development/cloudflare-cli.md` keeps these steps. cf changed the Wrangler version it accepts between two betas published five days apart, so whoever reviews a cf update, an agent or the maintainer, runs the check and notes the result on the pull request. A pass does not gate the update; it means the later change can be proposed. The account commands need no manual step, because the `--dry-run` test of Decision 1 runs on every pull request.

The later change also resolves the `migrations_dir` TODO, replaces the all-zero placeholder D1 ID that cf rejected on 2026-11-07, turns off `cf deploy --provision` (on by default) so that a deploy never creates resources the state file does not know about, and decides what replaces `wrangler tail`.

## The `cloud:free` flow after this change

- `deploy`: check `CLOUDFLARE_ACCOUNT_ID` and the versions of cf and Wrangler; refuse when the state file exists or the scripts search finds `davloom-probe`; record a random database name, create the database with cf and record its ID; confirm, with retries, that `cf d1 list --name` shows it; write the generated Wrangler config with that ID; apply the migrations with cf; record the upload marker and deploy with Wrangler; confirm, with retries, that the scripts search shows the Worker and the namespace listing shows its namespace; wait for the health check and confirm the token guard, as today.
- `measure`: check `CLOUDFLARE_ACCOUNT_ID` and Wrangler's version, then measure as today, with the account reaching `wrangler tail`.
- `destroy`: check `CLOUDFLARE_ACCOUNT_ID` and the versions of cf and Wrangler; when the upload started, deploy the tombstone with Wrangler and delete the Worker with cf; delete the database with cf; confirm each started resource as Decision 5 describes; then remove the state file and the generated config.
- `all`: unchanged. It runs `deploy` and `measure`, then `destroy` whenever a state file exists.

## Changes to `prd.md`

- The header moves from v1.4 to v1.5, with the date of the edit.
- §2, Engineering Quality: a new row, "Cloudflare CLI | cf, with Wrangler bundling and deploying Workers until cf can do both on Bun".
- §11, Rollout Plan: the "On release" row reads "Changesets, cf (with Wrangler until cf deploys on Bun), Docker Buildx, Trivy, Syft SBOM + license check, Artifact Attestations".
- §11, Tooling Choices: a new bullet, "**cf, not Wrangler:** The maintainer chose Cloudflare's cf CLI on 2026-11-07. cf manages D1 databases, Workers and Durable Object namespaces. Until a cf release can build and deploy on Bun, Wrangler bundles, deploys and tails the Workers, because cf's build and deploy load `cloudflare.config.ts` through a loader that refuses Bun."

No other part of the PRD names a Cloudflare CLI. These edits carry out the maintainer's decision rather than settle a conflict between the PRD and a spec, and they wait for the maintainer's review with the rest of this change.

## Effect on `add-ci-baseline`

| Task | Effect |
| --- | --- |
| 2.1 (PR #10) | Prerequisite. This change keeps its harness and edits the same `package.json`, so it starts after PR #10 merges |
| 3.1 `check` | Same commands. `bun run check` still bundles `apps/api` with `wrangler deploy --dry-run`, now on Wrangler 4.160.0, calls no cf and needs no credentials |
| 3.2 `compat` | Runs the new unit tests of the probe flow and the `--dry-run` test of the cf calls inside `bun run test:compat`, with no account, no secret and no sign-in |
| 4.1 `dependencies` | OSV-Scanner also scans cf's dependency tree |
| 5.2 | No workflow gains a secret, and `cloud:free` stays a manual run |
| 6.1 Renovate | Gains the Cloudflare group from Decision 7 |
| Decision 7, Bun only | Unchanged; it is the reason for Decision 2 |

The jobs in Decision 1 of `add-ci-baseline` and the target layout in its Decision 10 do not change.

## Differences between Cloudflare Workers and Bun

The Workers code, both Worker configs and the local Workers tests stay as they are, and the self-hosted Bun runtime uses neither cf nor Wrangler, so nothing in this change behaves differently between the two runtimes. Bun matters here only as the runtime of the tools: cf's account commands run on it, and its build, deploy and dev commands do not.

## Logic that decides an outcome without IO

The change adds no product logic and no law to `LAWS.bend`. The probe flow gains a few checks: whether the account variable is set, whether a state file or a probe Worker already exists, which listing entries match a name exactly, and which resources the cleanup can count as gone. PRD §4 governs the logic of Davloom itself, which the TypeScript packages call through compiled Bend modules. These checks belong to the test harness under `tests/integration/compat`, which no package ships and no production entry imports, and the Bend toolchain arrives only in Phase 1 with `packages/laws`. They stay in TypeScript, covered by the unit tests in Decision 6. Maintainer review item 4 asks the maintainer to confirm this reading of §4.

## Risks / Trade-offs

- [cf is a beta whose generated commands follow Cloudflare's public OpenAPI release, so names, flags and output can change in any release] → Exact pin, one module for every cf call, unit tests that fix each call's arguments, the `--dry-run` test of Decision 1, Effect Schema decoding, and the check in Decision 8 on every update.
- [Neither cf's nor Wrangler's network calls have run on Bun, because that needs the maintainer's approval] → Task 6.1 asks for one approved run. `all` destroys whenever a state file exists, and a failed `destroy` keeps the state file for a rerun. If a cf call fails on Bun, its data and the options go to the maintainer, and no operation moves back to Wrangler silently.
- [`cf workers delete` goes through the Workers API and may not reach a Worker that `wrangler deploy` uploaded, or the scripts search may not list it] → Decision 5 then ends the run with the Worker named as remaining or unconfirmed, and the maintainer deletes it by hand. Task 6.1 records which case occurred.
- [A lookup by name matches other resources in the account] → Only exact matches count, and the flow deletes nothing when there is not exactly one.
- [A package without its own copy of cf or Wrangler runs a global one from `PATH`] → Every step checks the versions before its first account call, and `docs/development/cloudflare-cli.md` warns about global copies.
- [Two sign-ins] → `CLOUDFLARE_ACCOUNT_ID` is required, and `docs/development/cloudflare-cli.md` says how to sign in to both tools or use one token.
- [cf and Wrangler stop pinning the same Miniflare] → The Renovate group shows it in one pull request, and Decision 7 says what to do.
- [`wrangler tail` keeps missing events] → Unchanged here; a later change can move the CPU measurement to Workers Logs (`cf o11y telemetry query`) or to a Tail Worker.

## Migration Plan

1. After PR #10 merges, implement on a GitButler branch based on `main`, in the order of tasks.md.
2. The dependency update, the cf module, the new flow and its tests land in one pull request. The docs and the PRD edit can follow in a pull request stacked on it.
3. Task 6.1 asks the maintainer for one `cloud:free all` run, and its findings go under `docs/architecture/`.

Rollback: revert the pull request. The Wrangler flow comes back unchanged, and a state file that the new flow wrote still works for the old `destroy`, which reads only the database name.

## Maintainer review

These decisions block implementation, so they are listed here instead of under open questions:

1. The split in Decision 2. The maintainer chose cf over Wrangler and ruled out Node on the same day, and cf 1.0.0-beta.29 cannot build or deploy on Bun. This design follows both decisions as far as they fit together: cf for account operations, Wrangler for bundling, deploying and tail. The other options are to move nothing until cf builds on Bun, or to let cf's project commands run on Node. The PRD edits follow from the choice.
2. The cf version. The Dependencies rule takes the version that `latest` points to, and says that pre-release tags do not count. cf's `latest` points to 1.0.0-beta.29. The last release without a pre-release identifier, 0.15.0 from 2026-09-25, is not on `latest` and depends on a Miniflare alpha. This design reads the rule as allowing the beta, because the rule speaks of tags. PR #10 treats its `miniflare` beta as an exception, but that beta is not on `latest`. If the maintainer counts cf as an exception too, it needs their approval like the `miniflare` pin.
3. The `miniflare` pin. Decision 7 moves the direct `miniflare` dependency from 5.20261104.0-beta, which PR #10 asks the maintainer to approve, to 5.20261110.0-beta. It is the same exception at a newer version.
4. Bend. This design reads PRD §4 as covering Davloom's product logic and not its test harness, so the new checks of the probe flow stay in TypeScript. If the maintainer wants them proven as well, they wait for `packages/laws` in Phase 1.

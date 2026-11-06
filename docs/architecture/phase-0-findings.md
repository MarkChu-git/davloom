# Phase 0 compatibility findings

This document records the results of the Phase 0 verification checklist in section 13 of the PRD. OpenSpec change: `add-phase-0-foundation`.

Local verification and the Cloud Free measurements are both complete.

## Environment

Local tests run on macOS (Apple Silicon) with Bun 1.4.4 and Node 26.12.0, and `wrangler dev` starts workerd. The browser is the locally cached Chromium headless shell 1243, not the 1248 that matches Playwright 1.64.1. Unless noted otherwise, the dependency versions in this document are those of the npm `latest` tag on 2026-11-06. The Cloud Free measurements deploy to workers.dev, on a Workers Free account.

The results below are from `bun run test:compat`. During the run, `XDG_CONFIG_HOME` pointed to an empty directory and Wrangler was logged out; `bun run check` and this command both exited with status 0.

| Test layer                                       | Command            | Result                |
| ------------------------------------------------ | ------------------ | --------------------- |
| Transport and probe (Bun, workerd)               | `test:http`        | 111 passed            |
| Identity (D1)                                    | `test:d1`          | 6 passed              |
| Identity (Bun SQLite)                            | `test:bun-sqlite`  | 6 passed              |
| UI (Bun and Workers delivery)                    | `test:ui`          | 43 passed, 1 skipped  |
| Rebuild after changing the brand color           | `test:ui:brand`    | 4 passed              |
| Cloud Free flow dry run on local workerd         | `test:cloud:local` | 34 passed, 1 skipped  |
| Cloud Free measurement, no deployment configured | `test:cloud`       | 11 passed, 24 skipped |

The UI layer skips "a missing static asset returns 404", which applies only to Bun. The dry run skips the 105 MB case, since there is no request body limit locally.

## Verification checklist

| #   | Item                                                                   | Result                                                | Evidence                                                                                                                                                                                                                                                             | Dependency versions                                           |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Elysia + Effect on Cloudflare Workers                                  | Passed on local workerd and on a real deployment      | `http/effect.test.ts`: the responses for success, declared errors and unexpected defects match on Bun and workerd; the probe Worker on workers.dev passes all 35 cases                                                                                               | `elysia` 1.4.31, `effect` 4.1.2, `wrangler` 4.158.0           |
| 2   | Better Auth + D1 / SQLite                                              | Passed                                                | `identity/d1.test.ts`, `identity/bun-sqlite.test.ts`, `http/basic-auth.test.ts`                                                                                                                                                                                      | `better-auth` 1.7.18, `drizzle-orm` 0.45.4                    |
| 3   | TanStack Start + React 19                                              | Passed                                                | SPA production build; `ui/delivery.spec.ts` opens a deep route directly under both delivery methods                                                                                                                                                                  | `@tanstack/react-start` 1.169.4, `react` 19.3.1, `vite` 8.3.6 |
| 4   | Astryx components integrated with TanStack Start                       | Passed                                                | `ui/interactions.spec.ts`: a Dialog and a Menu are operated from the keyboard, focus returns to the trigger element, and the console shows no errors                                                                                                                 | `@astryxdesign/core` 0.7.8                                    |
| 5   | StyleX compilation in Vite                                             | Passed                                                | `ui/styles.spec.ts` reads the computed styles of Davloom's own components on the production build                                                                                                                                                                    | `@stylexjs/stylex`, `@stylexjs/unplugin` 0.19.1               |
| 6   | Astryx Theme and Dark Mode                                             | Passed                                                | `ui/appearance.spec.ts`, `scripts/verify-brand-change.ts`. The first-paint case fails when the head script is removed                                                                                                                                                | `@astryxdesign/core`, `@astryxdesign/theme-neutral` 0.7.8     |
| 7   | Cloudflare Free CPU and request cost, covering the authentication path | Passed, no request exceeded a limit                   | On workers.dev, 100 requests carrying an API Key and 20 logins all succeeded; see "Cloud Free measurements" for the CPU distribution and row counts                                                                                                                  | Same as items 1 and 2                                         |
| 8   | Durable Objects CPU limit and file writes on Free                      | Passed, the 30-second limit holds                     | A 95 MB write was read back with a matching SHA-256; a request that used 32.3 seconds of CPU completed, and longer requests were reset at about 30.2 seconds                                                                                                         | `wrangler` 4.158.0                                            |
| 9   | WebDAV methods through Elysia, Workers and Bun                         | Passed locally and on a real deployment               | `http/echo.test.ts`, `http/production.test.ts`; on workers.dev, 12 methods and the WebDAV request headers arrived unchanged                                                                                                                                          | `elysia` 1.4.31                                               |
| 10  | PUT and GET stream end to end                                          | Passed                                                | `http/streaming.test.ts`, `http/large-upload.test.ts`. When the code is deliberately changed to buffer, the memory increase is 1918 MiB and both sets of tests fail. On workers.dev, 95 MB was written and read back through the Worker, which used only 4 ms of CPU | Bun 1.4.4, `elysia` 1.4.31                                    |
| 11  | Synchronous processing limit for directory COPY/MOVE                   | Decided: 1000 objects for Durable Objects, 400 for R2 | 2000 objects were copied and deleted within one request without hitting a platform limit; the R2 figure is estimated from the documentation                                                                                                                          | Same as item 8                                                |
| 12  | Elysia starting version                                                | Decided: 1.4                                          | See the next section                                                                                                                                                                                                                                                 | `elysia` 1.4.31, `2.0.0-rc.3`                                 |

## Elysia version comparison

Results of the transport-layer tests (`tests/integration/compat/http`, 111 cases in all) on the two versions:

| Version             | Bun        | Workers (local workerd) | Memory increase for a 1 GiB upload (Bun) |
| ------------------- | ---------- | ----------------------- | ---------------------------------------- |
| `1.4.31` (`latest`) | All passed | All passed              | 20-40 MiB, the range across several runs |
| `2.0.0-rc.3` (`rc`) | All passed | All passed              | 20-38 MiB, the range across several runs |

Finding: under the decision rule in the design, the starting version is 1.4. The rerun command is `bun run test:http:elysia-rc`. It runs in the `tests/integration/compat` directory and restores the dependencies and source when it finishes.

Migrating to 2.0 takes two changes, and the script `tests/integration/compat/scripts/rerun-with-elysia.ts` contains the matching replacements:

- The parameter position of route hooks changed: `.all(path, handler, hook)` becomes `.all(path, hook, handler)`, and the old order throws at startup.
- `elysia/adapter/cloudflare-worker` no longer exists, so the Workers entry switches to `elysia/adapter/web-standard`.

## Memory use when streaming (Bun)

The figures below come from a one-off measurement made with `Bun.serve` alone, without Elysia; the script is not in the repository. Memory did not grow when the reader slowed down, which shows that Bun applies backpressure to both request and response bodies.

| Scenario          | Reader delay              | Resident memory after startup | High-water mark at the end |
| ----------------- | ------------------------- | ----------------------------- | -------------------------- |
| Upload 1024 MiB   | None                      | 8 MiB                         | 39 MiB                     |
| Upload 512 MiB    | 5 ms wait after each read | 8 MiB                         | 32 MiB                     |
| Download 1024 MiB | None                      | 6 MiB                         | 69 MiB                     |
| Download 256 MiB  | 2 ms wait after each read | 5 MiB                         | 20 MiB                     |

## Cloud Free measurements

The measurements ran on 2026-11-06 on a Workers Free account, and the maintainer confirmed the plan in the Dashboard. Command:

```bash
bun run --filter @davloom/compat-tests cloud:free all
```

It creates a D1 database in the account Wrangler is logged in to, deploys a probe Worker with a one-time token, deletes the Durable Object data, the Worker and the database after measuring, and then lists the resources to confirm. One run writes about 31,000 rows of Durable Object data, about a third of the daily quota. The CPU data comes from `wrangler tail`; the raw results are in [phase-0-cloud-free-results.json](phase-0-cloud-free-results.json).

The first run failed before any measurement started; see "Problems found and fixed by the tests" for the cause. Cleanup completed as usual and consumed almost none of the quota. After the fix, the second run passed all 35 cases in 373 seconds.

### Deployment

| Item                      | Result                                                   |
| ------------------------- | -------------------------------------------------------- |
| Upload size               | 3642.50 KiB, 646.44 KiB after gzip                       |
| Startup time              | 76 ms and 119 ms for the two deployments, limit 1 second |
| Request without the token | 404                                                      |

### Worker CPU

| Request                         | Count | Result  | CPU (samples received by tail)              |
| ------------------------------- | ----- | ------- | ------------------------------------------- |
| PROPFIND with an API Key        | 100   | All 200 | 6 samples: p50 3 ms, max 24 ms              |
| Admin login in the Worker       | 20    | All 200 | 12 samples: p50 63 ms, p90 80 ms, max 94 ms |
| CPU load increased step by step | 36    | All 200 | Highest 1134 ms                             |

The documented Workers Free limit is 10 ms per request, and exceeding it returns 1102. No request was blocked this time; even the request that used 1134 ms returned normally. This leniency is not in the documentation, so the design still leaves headroom against 10 ms.

`wrangler tail` did not receive every event: only 6 of the 100 API Key requests and 12 of the 20 logins, so the CPU distribution in the table above represents only those samples. Durable Object calls also show up in the tail.

### Durable Object

| Item                                           | Result                                                                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin login inside the Durable Object, 5 times | All 200. Durable Object CPU p50 75 ms, max 117 ms; the forwarding Worker used 0 ms                                                                                                                         |
| Write 95 MB                                    | 200, 91 chunks, 185 rows written. 11.8 seconds on the client, Worker CPU 4 ms, Durable Object CPU 937 ms                                                                                                   |
| Read back 95 MB                                | 200, 4.4 seconds, SHA-256 matches what was written                                                                                                                                                         |
| Upload 105 MB                                  | 413                                                                                                                                                                                                        |
| CPU load increased step by step                | A request that used 32,278 ms completed, taking 35.2 seconds of wall-clock time; the next request was reset at 30,221 ms and returned 502 with `Durable Object exceeded its CPU time limit and was reset.` |

The 30-second CPU limit holds on Free. The cut-off point is not exact: one request ran for 32.3 seconds before it ended, so the design assumes 30 seconds.

### Row counts

The row counts on the real deployment match the local workerd baseline exactly:

| Operation                          | D1                                     | Durable Object              |
| ---------------------------------- | -------------------------------------- | --------------------------- |
| One request carrying an API Key    | 3 queries, 5 rows read, 2 rows written | Not involved                |
| List a directory with 100 children | Not involved                           | 100 rows read               |
| Write 95 MB in 91 chunks           | Not involved                           | 185 rows written            |
| Create 1 object                    | Not involved                           | 5 rows written              |
| Copy and delete 1 object           | Not involved                           | 7 rows read, 7 rows written |

By these numbers, the D1 write quota of 100,000 rows per day covers only 50,000 requests carrying an API Key, so it runs out before the Workers limit of 100,000 requests per day. The Durable Object write quota covers copying and deleting about 14,000 objects per day.

### Synchronous processing limit for directory COPY/MOVE

Within one authenticated request, 1 KiB objects were copied and deleted one by one inside the Durable Object:

| Objects | Result | Durable Object CPU | Rows written | Client time |
| ------- | ------ | ------------------ | ------------ | ----------- |
| 100     | 200    | 5 ms               | 700          | 106 ms      |
| 400     | 200    | 14 ms              | 2,800        | 165 ms      |
| 2,000   | 200    | 91 ms              | 14,000       | 261 ms      |

Even at the measurement cap of 2000 objects, no platform limit was hit. The real constraint is the write quota of 100,000 rows per day, and processing 2000 objects at once uses 14% of it.

Limits the maintainer set on 2026-11-06:

- Durable Objects: at most 1000 objects at a time, writing about 7000 rows, which is 7% of the daily write quota.
- R2: at most 400 objects at a time. R2 can only be enabled after a payment method is attached, so it was outside this round of measurement. Free allows at most 1000 internal subrequests per request, and R2 calls count toward that. Copying an object takes one read and one write, and a move adds a delete that can run in batches; the remaining calls are left for authentication and directory listing. Once R2 is enabled, the limit must be confirmed by measurement.

### Cleanup

Both runs deleted the Durable Object namespace (by deploying a configuration with `state: "deleted"`), the Worker and the D1 database, in that order, then listed the resources with `wrangler` to confirm that the Worker and the database no longer exist. Wrangler has no command that lists Durable Object namespaces, so the namespace deletion is judged by whether that deployment succeeded.

## Problems found and fixed by the tests

- `GET` and `HEAD /dav/*` on Bun used to return 404. Elysia matches routes for a specific method first, so the Dashboard route `.get("/*")` took precedence over `.all("/dav/*")`. The Dashboard route now uses `.all("/*")`.
- `/%00` on Bun used to return 500, because `Bun.file` throws on a null byte. It now returns 404.
- `/api` on Workers used to fall through to the SPA and return 200. `run_worker_first` now includes `/api`, so the API's own 404 is returned.
- The `beforeAll` of the Cloud Free measurement used to call `expect.poll()`, which Vitest allows only inside a test. That code runs only on a real deployment, so the local dry run could not catch it, and the first measurement failed before measuring anything. It now uses `pollUntil` from `cloud/tail.ts`; when tail cannot connect, it stops with Wrangler's error and no longer consumes quota.

## Differences between the two delivery methods

| Request                 | Bun | Workers static assets     |
| ----------------------- | --- | ------------------------- |
| Missing `/assets/x.js`  | 404 | 200, returns `index.html` |
| POST to `/design-check` | 405 | 405                       |

The first row comes from the SPA fallback: `not_found_handling` returns `index.html` for every unmatched path. This does not affect functionality; it only means a missing asset does not show up as a 404 on Workers.

## Follow-up actions

- Phase 2: the bare path `/dav` now returns 404, and the spec covers only `/dav/`. When real WebDAV clients are connected, decide whether the bare path should reach the WebDAV entry point.
- Phase 3: decide whether to disable the writes made during API Key verification, or to add a cache; the reason is in the quota estimate above.
- Phase 3: admin login in the Worker used 63-94 ms of CPU, far above the 10 ms in the documentation. Free did not block it this time, but the documentation does not promise that. The maintainer then decides whether password verification moves into a Durable Object (measured at 75-117 ms, within the 30-second limit) or stays in the Worker; the hash strength stays the same.
- Phase 4: the example page `/design-check` is currently in the production build; remove or hide it before the final pages are done.
- Phase 4: the theme does not load `fonts.css` from `@astryxdesign/theme-neutral` (which loads fonts from Google Fonts), so fonts fall back to system fonts. Decide then whether to load the fonts or self-host them.
- `bun pm untrusted` lists the postinstall scripts of `@astryxdesign/core` and `@astryxdesign/cli` as blocked. They were not run, and all tests pass.
- `wrangler tail` received only some of the events. When a complete CPU distribution is needed later, use Workers Logs or a Tail Worker instead.

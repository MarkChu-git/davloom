# Architecture

Davloom follows Hexagonal Architecture: the protocol engine and the application services reach
storage, the database and identity only through Ports, and each runtime provides Adapters for them.

```text
            clients (Finder, rclone, …)            browser (Dashboard)
                     │  WebDAV + Basic (API Key)          │  REST + session cookie
                     ▼                                    ▼
 apps/api ── Elysia: /dav/* ─────────────────── /api/* ── Better Auth /api/auth/*
                     │                                    │
 packages/webdav ── protocol engine (Request → Response)  │
                     │ Storage Port, LockStore, authorize  │
 packages/core ───── Mounts, key scopes, application services (Effect) ── Ports
                     │                                    │
 packages/laws ───── Bend 2 decisions, compiled to JavaScript and proven
                     │
 adapters:  packages/storage (Durable Objects, object store with S3 and R2 drivers)
            packages/database (Drizzle on D1 and Bun SQLite: records, locks, dead properties)
            packages/auth (Better Auth: admin, sessions, API Keys)
```

## Requests

A WebDAV request reaches `apps/api/src/app.ts`, which checks the credential: an API Key sent as the
Basic password (one D1 read, cached for 30 s), or the Dashboard's session together with the header
`X-Davloom-Dashboard: 1`. It then hands the request to the engine in `packages/webdav` with three
things: the namespace (every Mount as a top-level collection), the lock store, and an `authorize`
function. The engine parses the request, evaluates the `If` header and the conditional headers,
checks locks, and calls the Storage Port. `authorize` asks the proven policy whether the key's
access level and scope allow the method on the target and, for COPY and MOVE, the destination.

## Storage

The Storage Port (`packages/core/src/storage.ts`) is a tree: stat, list, read with a range, write a
stream, create a collection, remove, copy, move, dead properties and usage. Operations return results
instead of throwing, so the same interface crosses Workers RPC. Every adapter gathers facts from its
storage and decides the outcome with the proven decisions of `packages/laws/src/transfer.bend`, so
every backend answers the same way, in the same order. The storage contract in
`packages/core/src/testing/storage-contract.ts` checks each adapter against an in-memory reference,
with scenario tables and random sequences of operations.

- **Durable Objects**: one object per backend. Entries form a tree by id, so a move rewrites one row;
  content lives in 1 MiB chunk rows; every operation commits in one SQLite transaction.
- **Object store (S3, R2)**: a file is a key, a collection a marker key ending in `/`, and a folder
  without a marker is still a collection. Moves copy first and delete after, so a failure never loses
  a file. Dead properties live in the `dav_properties` table.

A copy or move touches at most a fixed number of entries in one request: 1,000 for a Durable Objects
copy (a move there renames one row, so it has none), 400 for R2, 30 for S3 on Workers, whose
requests count toward the Free plan's 50 subrequests along with the request's own heads and
listings, and 1,000 for S3 on Bun. On object stores a destination that the request replaces counts
too. A request over the
limit changes nothing and answers 403 with a short explanation (the law `limit_exact`).

An object-store move of a collection records its destination in the Property Store, under a path
that begins with `..`, which no entry's path does, so clients can neither read nor set it and no
copy of the tree carries it. It writes the record before it moves the source's properties and
removes the source, and drops it once the source is gone; removing the source drops it too. If the removal stops part-way, every file is in the destination and some
are still in the source. A client's retry of the move, with `Overwrite: T` as clients send by
default, finds the record and resumes: it copies what is left, with its properties, over the
destination and removes the source, instead of replacing the destination and the files already moved (the laws
`resume_into_collection` and `resume_needs_journal`).

## Proven decisions

`packages/laws` holds the Bend 2 modules, `LAWS.bend` with the laws, and `PROOF.bend` with their
proofs, which `bun run laws:check` checks with both `bend PROOF.bend` and `bend PROOF.bend --verdict`.
The TypeScript packages call the compiled modules (`src/compiled/*.mjs`) through typed wrappers, and
fast-check and table tests check the compiled code against independent oracles.

## Runtimes

|           | Cloudflare Workers                     | Bun (Docker)                       |
| --------- | -------------------------------------- | ---------------------------------- |
| Entry     | `apps/api/src/entry.workers.ts`        | `apps/api/src/entry.bun.ts`        |
| Records   | D1                                     | Bun SQLite in `DAVLOOM_DATA_DIR`   |
| Storage   | Durable Objects; S3; R2 with a binding | S3-compatible                      |
| Dashboard | Workers static assets                  | served from `apps/web/dist/client` |

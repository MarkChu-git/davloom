# Design

## Context

See proposal.md for why this change exists. The code it builds on:

- `packages/core` exports `makeHttpRunner` and `responseFromExit`, which map an Effect program's result to a `Response`. It has no Ports yet.
- `packages/database` defines Better Auth's tables in Drizzle with one migration, `0000`, and opens them on D1 and on Bun SQLite.
- `packages/webdav` exports a handler that answers 501 to every request, and `apps/api` routes `/dav/*` to it on both runtimes. No unit test covers the handler yet.
- `vitest.config.ts` gives every package under `apps/` and `packages/` coverage thresholds, and `scripts/coverage-thresholds.test.ts` fails when a package has none.
- The Phase 0 probe in `tests/integration/compat/probe` holds a Durable Object that stores paths and 1 MiB chunks in two tables. Its measurements are in `docs/architecture/phase-0-findings.md`: writing 95 MB took 91 chunks and 185 rows and 4 ms of Worker CPU through `stub.fetch`, and copying then deleting 2,000 objects inside one request used 91 ms of CPU and 14,000 rows.
- Decision 10 of `add-ci-baseline` already plans for this phase: the Bend proofs and the requirement coverage check join the `check` job, and the storage and database contracts get a job each.
- Bend 2.0.40 is the latest release (2026-11-06), with archives for macOS and Linux on arm64 and x64. Its `--verdict` kernel builds with Lean 4.34.0.
- Cloudflare documents that a SQLite-backed Durable Object at its storage limit fails every `INSERT` and `UPDATE` with `SQLITE_FULL`, while `SELECT` and `DELETE` keep working. A request to a Durable Object may use 30 seconds of CPU by default. R2 takes at most 5 GiB less 5 MiB in one upload.

The constraints that shape the approach are the PRD's dependency rules and Proven Domain Logic (§4), its workflow security rules (§11), the Cloudflare Free limits in PRD §9, and the owner's decision of 2026-11-19 that each Durable Objects backend is one Durable Object.

## Goals / Non-Goals

**Goals:**

- Phase 2 can build the WebDAV methods on the Storage Port and on the backend service. It will add ranges, content types and preconditions to them, but nothing this change defines needs to change.
- The namespace model is the oracle of the storage contract suite, so every adapter is measured against the code that the proofs cover.
- Each adapter runs where it can run: Durable Objects and R2 on Workers, S3-compatible storage on Workers and on Bun.

**Non-Goals:**

- No route reaches storage or the database, and the production Wrangler configuration does not change. Phase 2 wires the Layers into `apps/api` and exports the Durable Object class from the production Worker.
- No synchronous limit for directory operations. The Storage Port carries no limit, and Phase 2's COPY/MOVE planning sets and proves it.
- No uploads of unknown length or above 5 GiB less 5 MiB, so no multipart uploads. A write states its size.
- No `Overwrite`, `Depth` or `Destination` semantics, no ETag preconditions, no HTTP Range and no content types. These belong to the protocol in Phase 2.
- No recovery from a failure in the middle of a multi-object operation on R2 or S3, and no conflict checks for concurrent writers on R2 or S3. Phase 2 proves recovery, and the conflict checks of PRD §5 come with the WebDAV phases.
- No editing of a saved backend. Phase 4's Storage page adds it when it needs it.
- No `packages/schema` or `packages/client` yet. The few schemas this change needs live beside their service until a client shares them.

## Decisions

### 1. Where each part lives

| Package | Layer | Holds |
| --- | --- | --- |
| `packages/laws` | Domain | The Bend modules `namespace.bend`, `objects.bend` and `backends.bend`, their compiled `.mjs`, `LAWS.bend`, `PROOF.bend`, the typed wrappers, the property tests and the toolchain pins |
| `packages/core` | Domain and application | The Storage Port, its errors and path type, and the backend service with its own Ports: backend records, the credential cipher and the adapter factory |
| `packages/storage` | Infrastructure | The Durable Objects adapter and its object, the object-store adapter with its R2 and S3 drivers, and the adapter factory of each runtime |
| `packages/database` | Infrastructure | The `storage_backends` table, migration `0001`, and the backend records adapter for D1 and Bun SQLite |
| `tests/contracts` | Tests | The storage and database contract suites, with their Vitest configurations for workerd and Bun |

Only `packages/storage` imports `cloudflare:workers` or the AWS SDK. The credential cipher uses Web Crypto, which both runtimes provide, so it lives in `packages/core`.

Each new package gets its coverage thresholds in `vitest.config.ts` in the pull request that creates it, because the guard test fails without them. `tests/contracts` joins the root `workspaces` and the `typecheck` filter in the pull request that creates it.

Alternatives: putting the Port in `packages/storage` would mix the domain with vendor code. A package per adapter adds workspaces without a reader who needs the split.

### 2. The Storage Port presents a tree

The Port offers, per backend: describe, list, read, write, create a collection, remove, copy and move. A path is a list of names, and the root is the empty list. Bodies are Web streams, and a write takes its size. Copy and move take whole subtrees and require a free destination. Every operation is an Effect whose error channel lists the errors of `specs/storage-namespace/spec.md`, together with the adapter errors of `specs/storage-backends/spec.md`: insufficient storage, too large, hidden objects and unavailable.

An object-store Port, with get, put, list and delete by key, was the alternative. It would force the Durable Objects backend into the shape of S3, where nothing spanning two keys is atomic, although inside one Durable Object a whole subtree can change in one transaction. The namespace model also describes a tree, so a tree Port is what the contract suite can compare with the model.

### 3. The namespace model and its laws

`namespace.bend` models a namespace as a list of entries and a counter. Each entry has an id, its parent's id, a name and a kind: a file, with a content token that stands for its bytes, or a collection. The root is id 0, a collection with no entry of its own. The counter starts at 1, and each new entry takes the counter's value as its id and raises the counter, so no entry has the root's id and no id is used twice. This is the shape the Durable Objects adapter stores (Decision 5).

An operation is an `Op`: Create, Write, Remove, Copy or Move, with its paths. `apply(op, ns)` resolves the paths from the root by parent and name, gathers the facts the operation needs (the kind of each entry its paths reach, whether a destination lies inside its source, and for a copy or a move the longest path under the source), and passes them to the operation's decision function, which returns the outcome. On success `apply` returns the new namespace; on failure it returns the error and nothing changes. The adapters gather the same facts from their storage and call the same decision functions through the wrapper, so every backend decides as the model does.

When several errors apply, every backend reports the first in this order:

| Operation | Order of errors |
| --- | --- |
| Any | Invalid path, for any path of the operation |
| Describe, read, list | Not found; then a collection error for read, or a not-a-collection error for list |
| Create a collection | Already exists, including the root; missing parent |
| Write | Collection error, including the root; missing parent; size mismatch at the end |
| Remove | Root; not found |
| Copy | Not found; into itself, when a source collection's destination lies strictly inside it; already exists, including a destination equal to the source; missing parent; path too long, when a path under the destination would take more than 900 bytes |
| Move | Root; then the order of copy |

`LAWS.bend` defines `valid`: the ids are distinct, above 0 and below the counter, every entry's parent is the root or an entry that is a collection, no two entries have the same parent and name, following the parents from any entry reaches the root within as many steps as the namespace has entries, and every entry's path keeps the rules of paths and names. It states three laws about the module:

| Law | Statement |
| --- | --- |
| `keeps_valid` | A new namespace, which holds only the root, is valid, and every `Op` applied to a valid namespace gives a valid namespace |
| `accepts_valid_paths` | The module accepts a path exactly when `path_ok`, the rules of paths and names, accepts it |
| `decides_in_order` | For every operation and every set of facts, the decision function gives the outcome that `outcome_ok` gives: success, or the first error that the spec's requirements and the table above state |

Because `keeps_valid` starts from any valid namespace and ends in one, it holds after any sequence of operations. Within it, the decision that refuses a destination inside its source keeps a move from building a cycle, the counter keeps a new entry from taking an id that existing entries already point at, and the path-too-long error keeps a copy or a move from lengthening a path under it past 900 bytes. `outcome_ok` states the table above in Bend, so the owner approves the order of errors together with the laws. `decides_in_order` proves that the decision functions give that order; the contract suite checks that each adapter gathers its facts correctly.

A name takes at most 255 bytes in UTF-8, the limit of the file systems on which RustFS and Docker deployments keep their keys, and a path at most 900. A key with a prefix of up to 100 bytes and a marker's `/` then stays within the 1,024 bytes that S3 and R2 allow. PRD §4 places name validation in Phase 2; this change proves the storage namespace's own rule because the namespace laws need it, and Phase 2's path normalization and Mount resolution build on it for request paths.

The wrapper passes each name to Bend as its list of code points, so Bend sees a lone surrogate as a code point between U+D800 and U+DFFF and counts UTF-8 bytes itself.

Alternatives: the first draft keyed entries by path. A cycle cannot be written down in that model, and an entry's parent is a prefix of its path, so two of the PRD's three laws held by construction and their proofs would have said nothing about what the adapters store. A rose tree has the same problem.

### 4. Keys, listings and backend fields in Bend

`objects.bend` holds the rules that turn an object store into a tree:

- A file at a path is the key `<prefix><names joined by "/">`. A collection's marker is that key followed by `/`. The root is the prefix itself: it has no marker, and nothing writes or removes one for it.
- A key is read back by removing the prefix and splitting at `/`. A key that ends at `/` is a marker, whatever its size. A key whose parts are not valid names, or whose path breaks the path rules, forms no path and is hidden.
- A one-level listing of a collection, its object keys and its common prefixes, gives the collection's entries: each common prefix with a valid name is a collection, and each other key with a valid name is a file, unless a collection has the same name, which hides the file. The collection's own marker is skipped.
- A collection holds hidden objects when a key under its marker key is hidden, or when a file key equal to the collection's key without the `/` exists. Removing, copying and moving it then fail with a hidden-objects error.
- A write that states more than 5 GiB less 5 MiB is too large.

`backends.bend` holds the rules of backend configurations: the fields each kind needs, the rules of valid fields from `specs/storage-backends/spec.md`, and the instance secret's minimum length. It returns the first field that is missing or invalid, in the order of the configuration: the name, the kind, then the binding and prefix of R2, or the endpoint, region, bucket, prefix, path-style flag, access key and secret key of S3. It receives the endpoint already parsed by the runtime's `URL`, as its scheme and whether a user, a password, a query or a fragment is present, and the instance secret only as its length in UTF-8 bytes.

`LAWS.bend` states four more laws:

| Law | Statement |
| --- | --- |
| `keys_round_trip` | For every prefix that `prefix_ok` accepts and every path other than the root that `path_ok` accepts, reading back the file key gives the file at that path, and reading back the marker key gives the collection at that path |
| `listings_are_trees` | For every listing, every entry it gives has a name that `name_ok` accepts, and no two entries share a name |
| `decides_object_outcomes` | The module finds hidden objects exactly when `hidden_ok` does, and refuses a write as too large exactly when it states more than 5 GiB less 5 MiB |
| `accepts_valid_fields` | `backends.bend` reports the same first field that is missing or invalid, or none, as `first_bad_field`, and accepts an instance secret exactly when it has at least 32 bytes |

Every predicate these laws use, such as `path_ok`, `name_ok`, `prefix_ok`, `hidden_ok` and `first_bad_field`, is defined in `LAWS.bend`, which imports only `Base`, Bend's standard library, and the shipped modules, and a law reaches the modules only through the functions their wrappers call (`specs/proven-domain-logic/spec.md`). The modules can then be rewritten under their proofs, while what the laws mean changes only with the owner's label.

Effect Schema only reads each field of a backend configuration as missing, of the wrong type, or a value of its type: a boolean for the path-style flag and a string for every other field. `backends.bend` decides what each reading means, so a field of the wrong type is invalid in the same order as any other, and an endpoint that `URL` cannot parse reaches it as unparsable. Which fields a kind needs, and which values are valid, are Bend's.

### 5. The Durable Objects adapter

Each backend's object is `idFromName` of the backend's id. The service creates ids as random UUIDs and never reuses one, so a new backend never reaches an old object's data. The Worker calls the object through Workers RPC and passes bodies as streams, so the Worker never holds a whole file. Phase 0 measured 4 ms of Worker CPU for a 95 MB write through `stub.fetch`; RPC with streams is a different path, so its Worker CPU is measured again.

The object's tables, created by migrations that the object runs inside `blockConcurrencyWhile` when it starts:

- `entries`: an id, the parent's id, the name, the kind, and for a file its size, content id and last-written time. `UNIQUE (parent, name)` makes the database refuse a second entry with one name in one collection, and an index on the content id finds the entry that points at a content without reading the others. The root is id 0 and has no row.
- `chunks`: a content id, a position and up to 1 MiB of bytes per row, under the 2 MB row limit. Each write gets a content id from a counter that never hands out the same id twice, and the etag of a file is its content id, so it changes with every write.
- `pending`: the content ids whose chunks no entry may point to, while a write is in progress or while a read holds content that a write replaced.

Each operation reads its facts with synchronous SQL, decides through the namespace module, and writes inside one `transactionSync`, so it commits or rolls back as a whole.

A write checks its path and facts first, so a write that cannot succeed fails before it reads its stream. It then takes a new content id, records it in `pending`, and stores chunks as the stream arrives. When the stream fails, delivers more or fewer bytes than stated, or meets `SQLITE_FULL`, the write deletes its own chunks and its `pending` row and fails. Otherwise one transaction reads the facts again, because the tree may have changed while the bytes arrived, decides again, points the entry at the new content and removes it from `pending`, or deletes the new chunks and fails. In the same transaction the content the write replaced is deleted when no read holds it, and otherwise recorded in `pending` and deleted when its last read ends or is cancelled.

A read registers itself on the file's content id in the object's memory and streams the chunks in order. A missing chunk makes the stream fail rather than end short.

Removing deletes the subtree's entries and their chunks at once, with `DELETE` statements only, so it also works on a full object. A read that is streaming a removed file then fails at its next chunk instead of ending short, which `specs/storage-namespace/spec.md` allows.

When the object starts, before any request, it deletes the chunks of every content in `pending` that no entry points to, and clears those rows. It reads only `pending`, so a start costs a few rows however many files the backend holds. A restart also ends the reads that held replaced content.

The object runs one request's synchronous code at a time, and every decision is made again inside the transaction that commits it, so concurrent operations on one backend are safe.

Moving a collection updates one row of `entries`, so it writes the same number of rows, index rows included, for 100 files as for an empty collection. It reads its subtree, to learn the longest path under it, so the rows it reads grow with the subtree while the rows it writes do not. Copying lists the subtree with a recursive query and, in one transaction, inserts new entries and duplicates their chunks with `INSERT … SELECT`, so bytes never pass through JavaScript.

When storage is full, every insert and update fails with `SQLITE_FULL`, so creating, writing, copying and moving fail with an insufficient-storage error, and the transaction has rolled back. Describing, reading, listing and removing use only `SELECT` and `DELETE`, which keep working. Local workerd does not apply the 1 GB limit of Workers Free, so the contract test uses a subclass of the object, exported only by the test Worker, that overrides the method through which the object runs its inserts and updates and raises `SQLITE_FULL` there. The production class has no switch for it.

Removing a backend calls the object's `destroyIfEmpty()`, which checks that the root holds nothing and then calls `deleteAll()` before anything else can run, or fails with a not-empty error.

Alternatives: rows keyed by full path, as in the probe, make every rename of a collection rewrite each row below it. With 5,000 files in a folder that is 5,000 written rows before index rows, 5% of the daily quota, for a rename that Finder does often. A start that swept every chunk would read each chunk row on every start: 50,000 rows for 50,000 files, while Free allows 5 million rows read a day for the whole account. Sharing content between copies would save space and writes, but needs reference counts; copies count against the 1 GB, and sharing can come later without changing the Port.

### 6. One object-store adapter with R2 and S3 drivers

R2 and S3 present the same tree through `objects.bend`, so one adapter serves both, and a driver supplies the calls: head, get, put with a known length, a one-level and a recursive list, batch delete and copy.

- The R2 driver uses the Workers binding. The binding has no copy, so the driver copies by reading the object and writing it again as a stream of known length.
- The S3 driver uses the AWS SDK's `S3Client`, which the PRD names, with `forcePathStyle` from the backend's path-style flag, `requestChecksumCalculation` and `responseChecksumValidation` set to `WHEN_REQUIRED`, because the SDK's default checksums fail on several S3-compatible stores, and `EncodingType: "url"` on listings, so keys can hold characters that XML 1.0 cannot carry. It copies with `CopyObject`. `DeleteObjects` needs a checksum, and the SDK sends CRC32 there whatever those settings say (aws-sdk-js-v3#6819); if RustFS refuses it, the driver adds `Content-MD5` through an SDK middleware.

The adapter reads facts with head requests and one-level listings, decides through the namespace and objects modules, and then writes:

- A write that states more than 5 GiB less 5 MiB fails as too large before its stream is read. Otherwise the adapter counts the bytes itself and fails the upload, as a size mismatch, when the stream ends short or runs past the stated size. The R2 binding and the S3 request on Workers need a stream of known length, so on Workers the body goes through a `FixedLengthStream` of the stated size. Neither store keeps a failed upload, so the old object stays.
- A read counts the bytes the store delivers and fails when the body ends before the object's size, so a read never ends short.
- Removing, copying or moving a collection first lists everything under its marker key, in pages of 1,000, which also gives the longest path under it, and fails with a hidden-objects error before it changes anything when the objects module finds hidden objects.
- Removing an entry, or moving it away, first writes its parent's marker when the parent is not the root and has none, so a collection that another tool left without a marker survives the loss of its last entry.
- Removing deletes in batches of 1,000. Copying copies each object and writes a marker for each collection. Moving copies everything and then removes the source, so a failure in the middle can leave entries in both places but never in neither. Phase 2 adds recovery for that case.

On Workers each S3 call is an external subrequest, at most 50 per invocation on Free, and each R2 call counts toward 1,000. Removing costs about two calls per 1,000 objects. Copying costs one call per object with S3 and two with R2, and moving adds the removal, which puts the limit on Workers Free near 40 objects with S3 and near 400 with R2, as PRD §5 estimates for R2.

Alternatives: two adapters would duplicate the tree logic and test it twice. `aws4fetch` signs requests with a fraction of the code, but the PRD names the AWS SDK; it stays unless the SDK breaks the Workers bundle or startup limits, and then the owner decides.

### 7. Backend records and credentials

`storage_backends` holds an id, a unique name, the kind, the configuration without secrets as JSON, the encrypted secret key of an S3-compatible backend, and timestamps. An S3 access key is an identifier, not a secret, so it stays readable and the list can show it. A second backend with a taken name hits the unique index, and the records adapter turns the error of either database into a name-taken error.

The secret key is encrypted with AES-256-GCM under a key that HKDF-SHA-256 derives from the instance secret `DAVLOOM_SECRET`, a Workers secret on Workers and an environment variable on Bun. Each value gets a random 96-bit IV, and the backend's id is the additional data, so a ciphertext copied to another row fails to decrypt. A wrong instance secret makes the decryption fail, and the service reports a credentials error instead of signing requests with a wrong key. The Layers pass the secret's length to `backends.bend` when they are built, and fail, naming the variable, when it is missing or shorter than 32 bytes in UTF-8. Rotating the instance secret is out of scope.

Removing a Durable Objects backend calls `destroyIfEmpty()` on its object and then deletes the record. If deleting the record fails after the object emptied itself, the record points at an empty object and a second removal succeeds. Removing any other backend only deletes its record.

Alternatives: reusing Better Auth's secret would tie two subsystems to one setting without a decision about either. Encrypting the whole configuration would hide the bucket and endpoint from the list for no gain.

### 8. Effect services and Layers

The backend service in `packages/core` saves, lists, reads, removes and opens backends. It needs three Ports: backend records, the credential cipher and an adapter factory. `packages/storage` provides a factory for Workers, which opens all three kinds from the Worker's bindings, and one for Bun, which opens S3-compatible backends and answers the others with an unsupported-runtime error. `packages/database` provides the backend records on D1 and on Bun SQLite.

The Layers follow Phase 0's Decision 5: on Workers they are built at the first request and kept for the isolate, and on Bun at startup. The Effect service tests run the backend service on in-memory Bun SQLite with a fake adapter factory.

### 9. The database contract

The backend records adapter is written once against Drizzle's SQLite dialect, and the contract suite runs it on D1 in the Workers pool, as Phase 0's identity tests do, and on Bun SQLite. Its unit tests run the same queries on Bun SQLite, and the mapping of each database's unique-constraint error to name-taken is a function that unit tests give both error shapes, so `packages/database` keeps its branch threshold of 100 without the contract suite.

Migration `0001` is generated by `drizzle-kit`. The upgrade test applies `0000`, creates an administrator and an API key through Better Auth, applies `0001`, and then signs in, verifies the key and saves a backend. A schema test reads `sqlite_master` and `PRAGMA table_info` on both databases and compares them, leaving out `d1_migrations`, `__drizzle_migrations` and the tables whose names start with `_cf_` or `sqlite_`.

The adapter uses single statements. D1 has no interactive transactions, and nothing in this change needs several statements to commit together.

### 10. The Bend toolchain and its checks

`packages/laws/toolchain.json` pins Bend 2.0.40 and Lean 4.34.0, with the SHA-256 of each platform's archive. `bun run laws:setup` downloads both into a cache outside the repository, checks every archive against its pin, and builds the `--verdict` kernel once. CI caches the kernel under a key made from both versions and passes it to `bend` as `$BENDTT`, and every run sets `BEND_NO_TELEMETRY=1` so that `bend` skips its daily version check. The CI setup lands in the same pull request as the check step, so `check` never needs a Bend that CI lacks.

Implemented for task 2.1 on 2026-11-20. `scripts/laws-setup.ts` and `scripts/lib/laws-toolchain.ts` keep Bend and Lean in the tool cache that `docs/ci.md` describes, under `bend/<version>/<platform>` and `lean/<version>/<platform>`, and the kernel under `bendtt/bend-<version>-lean-<version>/<platform>`. Setup downloads each archive that the cache lacks and checks all of them against their pins before it unpacks any. Bun's `DecompressionStream` feeds Lean's `.tar.zst` to `tar`, because the bsdtar 3.5 of macOS has no zstd support of its own and needs a `zstd` program, which macOS does not ship. The kernel is built with the steps `bend` uses for its own, `lean --version`, `lean -c` and `leanc -O3 -DNDEBUG`, and cached only once it answers an empty input with ALL PROOFS CHECK. On macOS arm64 it links only `libc++` and `libSystem`, so there the cache needs only that one file. CI runs ubuntu-24.04, so task 2.3 checks what the Linux build links before CI caches it. Through the HTTP proxy that the Mac's environment sets, the Lean download twice stopped receiving data without closing its connection, once at 174 MB. Setup therefore resumes a download with a Range request after 60 seconds without data, after a failed connection or after a server error, until five attempts in a row end no further into the archive than an earlier one. The 60 seconds leave out the time spent writing to disk. A 206 for a range that starts elsewhere and a body shorter than its Content-Length count as failed attempts. A resume answered with 416 leaves the file to the SHA-256 check when the 416 gives the file's own length; any other 416 is a refusal. An error writing the file ends setup at once. Setup checks a downloaded Lean's version before it moves any release into place, and before it downloads anything it stops at a release directory that holds something but lacks one of the release's files, or at a kernel path that holds something other than a file, with an error that names the path to delete.

On macOS arm64, with Bun 1.4.4 and a `node` first on `PATH` that logged each call and failed, the first run took 523 seconds: 16 for Bend's 23.8 MB, about eight minutes for Lean's 561.7 MB with one resumed stall at 73.7 MiB, and 21 for the kernel. The cache then held 61 MB of Bend, 2.7 GB of Lean and a 3.2 MB kernel. A second run took under a second and downloaded nothing, and the log recorded no `node` call. With `$BENDTT` naming the cached kernel, `bend --verdict` printed ALL PROOFS CHECK for the `add_zero` law of Bend's guide and SOME PROOFS FAIL for a broken proof of it. A `$BENDTT` that names no file made it fail, so `bend` runs the kernel that the variable names.

`packages/laws` holds `toolchain.json` and a `src` with only a README until task 3.1. Its thresholds are 100% of lines and branches, which is what a package without code measures, as with the branch thresholds of `packages/database` and `packages/webdav`.

`bun run check` gains a laws step that:

- runs `bend PROOF.bend` and `bend PROOF.bend --verdict` and requires ALL PROOFS CHECK from both;
- compiles each shipped module to a temporary file and compares it byte for byte with the committed `.mjs`;
- refuses a foreign `import` in the shipped modules;
- checks that each law in `LAWS.bend` has a property test whose own name is the law's name, or the law's name followed by `:` and more;
- fails when `LAWS.bend` imports anything but `Base` and the shipped modules, and, from the top-level defs of each shipped module and the names each wrapper imports from its `.mjs`, when a law uses a def that its module's wrapper does not import.

`LAWS.bend` does not exist until the first laws land in task 3.5, and until then the step runs the checkers on `PROOF.bend` alone. Removing `LAWS.bend` later is a change that the approval check holds.

The property tests are Vitest tests with `fast-check` in `packages/laws`, so they run with the unit tests. They evaluate the predicates of `LAWS.bend` through a test-only compilation of it, which the rebuild check also covers. If the pinned Bend cannot compile those predicates, task 3.5 records it here and the tests state them in TypeScript.

Proofs can land before their laws. A lemma in `PROOF.bend` can be proven against predicates that `PROOF.bend` holds itself, and the pull request that states a module's laws moves those predicates into `LAWS.bend`. Each module's laws then need one label: one for `namespace`, one for `objects` and one for `backends`, after the one that the approval check's own pull request needs (task 2.2).

The compiled `.mjs` files are committed, so installing and testing Davloom, and building its Docker image later, does not need Bend. The rebuild check keeps them from drifting. Building them at install time was the alternative, but every consumer would then need the Bend toolchain.

The wrappers copy any array they hand to Bend and refuse a number above 2^48 − 1 before the call. When each module lands, a task measures its size in a Workers bundle and the CPU time of 1,000 calls on workerd and on Bun, as PRD §14 asks.

### 11. The `laws-approved` check

PRD §11 forbids `pull_request_target`, so a `laws-approval` workflow runs on `pull_request` for the `opened`, `reopened`, `synchronize`, `edited`, `labeled` and `unlabeled` events. The workflow is read-only by default, and its job declares `contents: read`, `pull-requests: read` and `actions: read`. It follows the concurrency rule of `add-ci-baseline`. Its job's result is the check that the `main` Ruleset requires, with GitHub Actions pinned as the check's source.

A Bun script reads the pull request's files, its timeline and the runs of this workflow for the pull request's head branch and head repository. It imports only Bun's built-ins and runs as `bun --no-env-file <script>` without an install, so no `.env` file can redirect its requests. The workflow installs a pinned Bun in its own steps, instead of the shared setup action, which reads `package.json` and installs dependencies. It keeps the step of Decision 7 of `add-ci-baseline` that proves no Node runs, and runs that step before the Bun setup, so the pinned Bun's directory comes ahead of the checkout's on `PATH`. The repository files that shape what the check does are then the workflow, the script and the root `bunfig.toml`, whose `preload` would run first. These three and `packages/laws/LAWS.bend` are the guarded files. The script reads each changed file under its new name and its old one, and when GitHub lists fewer files than the pull request's count of changed files, as it does above 3,000, it treats the pull request as one that changes a guarded file. Fixtures with a `LAWS.bend` of their own are not guarded.

The check passes when the pull request changes no guarded file. Otherwise it passes only when `laws-approved` is on the pull request, the latest `labeled` event for it names the owner, and that event came strictly after the head became the head. That moment is the creation of the first run of this workflow for the current head that comes strictly after both the latest run for a different head and the latest `head_ref_force_pushed`, `head_ref_restored` or `reopened` event in the timeline. When no run for the current head comes after both, the check fails. GitHub sets all these times, which a pusher cannot forge as they can a commit's own date. Timeline events cannot be deleted, so a head that a force-push replaced and a fast-forward brought back still starts after that force-push. The check does not defend against someone with write access who deletes run records on purpose; such a writer could also add the label from the owner's account. Closing and reopening a pull request drops its approval, even when the head stays the same. GitHub's times have a resolution of one second, so a label in the same second as that moment does not count. Every run decides afresh from these records, so a run that GitHub cancels or drops changes nothing. Fork pull requests get the same result, since every read works with the read-only token GitHub gives them. The decision lives in a function that unit tests run on recorded event and run payloads.

Under `pull_request` the check runs the pull request's own copy of the workflow, the script and `bunfig.toml`, so a pull request can rewrite the check that judges it. Guarding these files means that an honest change to the check needs the label, and so does the pull request that adds the check. A pull request that removes the guard from its copy is held only by the independent review that CLAUDE.md requires before every merge. The owner decides whether that is enough, or whether PRD §11 gets an exception for this one workflow. Such an exception would also need an Actions event policy that allows the workflow, because GitHub blocks `pull_request_target` by default in public repositories from 2026-12-02.

A label counts only when it came after the head, and GitHub records no new event for a label that is already there, so the owner approves each new head by removing the label and adding it again. That includes the commit GitHub pushes when it rebases a stack after a lower pull request merges, so a pull request that changes `LAWS.bend` is opened only after the pull requests below it have merged.

Agents act from the owner's account, so the check cannot tell an agent's label from the owner's. CLAUDE.md forbids agents to add the label. The check holds every pull request that keeps its guard, and the independent review covers one that changes it. Making the check required changes the `main` Ruleset, which is the owner's setting, so the task asks the owner first. The pull request that adds the check is the first to need the label, so it confirms the whole check on GitHub.

### 12. The requirement coverage check

PRD §11 asks that every scenario map to a test whose name carries the scenario's ID. OpenSpec gives a scenario no ID besides its name, so the name is the ID, and the check refuses two scenarios with one name.

A script in `bun run check` reads every scenario in `openspec/specs` and lists the tests of every suite without running them: `vitest list --json` for each Vitest configuration, and `playwright test --list` for the browser tests. The contract suites start no container while `DAVLOOM_LIST_TESTS` is set, which the script sets. A test covers a scenario when the test's own name, without the names of the blocks around it, is the scenario's name or the scenario's name followed by `:`, as in `Replacing a file: R2`.

`tests/verified-elsewhere.yaml` lists the scenarios verified on a real deployment, on GitHub, or by hand, with how. The script fails on a scenario without a test or an entry, on two scenarios with one name, and on an entry whose scenario no longer exists.

The script covers `openspec/specs` only. A change's scenarios join those specs when it is archived, so the check runs on them in the archive pull request, after the implementation has named its tests. Any change archived after task 8.2 enables the check, `add-ci-baseline` included, has to name its tests or list its scenarios before its archive pull request passes. Phase 0's tests do not yet follow the naming rule, so this change renames them and lists the scenarios that needed a real deployment.

Two scenarios already share a name: "The sample backends" in `dashboard-overview` and in `dashboard-storage-mounts`. The Overview's becomes "Bytes of the sample backends", edited in `openspec/specs` directly in the pull request that adds the check, together with its test. A delta cannot do it: a MODIFIED block may not drop a scenario, and a REMOVED and ADDED pair would only take effect at this change's archive, which leaves the check failing for all of Phase 1. The rename changes no behavior.

### 13. Contract suites, RustFS and coverage

`tests/contracts` runs the storage suite in two places. In workerd, through `@cloudflare/vitest-plugin`, it runs the Durable Objects adapter, and the object-store adapter with both drivers, with the Durable Object class exported by a test Worker and S3 requests going to RustFS. On Bun it runs the object-store adapter with the S3 driver against RustFS. RustFS 1.0.6 starts once per run from the `rustfs/rustfs` image, pinned by digest, in the suite's global setup through Testcontainers. Testcontainers' Ryuk container is pinned by digest too, or turned off with the global teardown removing RustFS; task 1.1 finds which works on Bun.

The suite has two parts: tests named after the spec scenarios, and the model-based test of "Backends match the model", which runs generated sequences of operations on the model and on an adapter and compares outcomes, trees and bytes after every step. The sequence count is set so that each contract job stays within the 3 to 4 minutes that Decision 10 of `add-ci-baseline` estimates. The `storage-contracts` job starts with the Bun run, and the workerd run joins it with the first adapter that runs there.

`packages/storage` runs mostly inside the contract suites, so its unit tests alone cannot reach useful coverage. Its entry in `vitest.config.ts` holds what its unit tests reach, and the `storage-contracts` job merges the Istanbul reports of those unit tests and of both contract runs and checks the thresholds of `tests/contracts/coverage.json` against the result. The merge uses `@vitest/istanbul-lib-coverage`, Vitest's typed copy of `istanbul-lib-coverage`, which `@vitest/coverage-istanbul` already installs. The workerd pool supports Istanbul coverage, but not V8's.

The workspace uses the same `@cloudflare/vitest-plugin`, Wrangler and Miniflare as the compat workspace, so the lockfile holds one copy of each. When the dependency rule asks for newer versions than compat pins, the pull request moves both workspaces together.

### 14. Mutation testing

StrykerJS 10.1.1 with its Vitest runner mutates `packages/core` and `packages/webdav`, one run per package, each with a break threshold of 80, so a failing run names its package. `bun run test:mutation` runs both locally, and a `mutation` workflow runs both every week and on `workflow_dispatch`. The test that runs Stryker on a fixture package lives in a Vitest configuration of its own, which `bun run test:mutation` runs and the unit tests do not, so `bun run check` never waits for Stryker; the requirement coverage check still lists it. `packages/webdav` has only its 501 handler until Phase 2, so this change adds a unit test of that handler, and the score covers little until then.

### 15. Tools that may not run on Bun

Testcontainers 12.2.2 declares Node 22.22 or later, and StrykerJS 10.1.1 declares Node 22 or later. Neither had been tried on Bun before task 1.1, and CLAUDE.md allows no Node. The first task of the implementation tries both under Bun. If either fails, the work stops and the owner chooses among the options found, because the PRD names both tools.

Tried for task 1.1 on 2026-11-20 with Bun 1.4.4 and Docker 29.8.2 in OrbStack on macOS arm64, in a workspace outside the repository, with a `node` first on `PATH` that logged each call and then failed. The trial used Testcontainers 12.2.2 and `@aws-sdk/client-s3` 3.1173.0, npm's `latest` that day, with the repository's Vitest 5.1.0. The log recorded no `node` call in any of the runs below. Inside `bun --bun`, Bun puts its own `node` first on `PATH`, so the log catches only the calls that bypass Bun, as Decision 7 of `add-ci-baseline` describes.

- Testcontainers runs on Bun unchanged. A Vitest global setup under `bun --bun` started `rustfs/rustfs:1.0.6@sha256:ee717072290bec9b11abfc0365f8310b00df1cd9b3639943edae47bdef05044a` and waited for its listening ports, since the image has no health check. A test then created a bucket and found it with `ListBuckets`. With Ryuk pinned through `RYUK_CONTAINER_IMAGE` as `testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0`, and again with Ryuk turned off through `TESTCONTAINERS_RYUK_DISABLED=true`, the teardown's `stop()` removed RustFS and no container was left after the run. In a third run the teardown left RustFS running: Ryuk removed it 11 seconds after the run ended, and then exited and was removed itself.
- The contract suites use Ryuk pinned by that digest, because it also removes the container of a run that crashes or is killed before its teardown, and the teardown still stops RustFS itself. Testcontainers reads `RYUK_CONTAINER_IMAGE` when it creates a container and when it starts Ryuk, so the global setup can set it before it creates the RustFS container. It also reuses a Ryuk that another session started, whatever that Ryuk's image, so the pin holds for certain only where no other session's Ryuk runs, as on a fresh CI runner.
- Testcontainers finds Docker through `DOCKER_HOST`, through `docker.host` or `tc.host` in `~/.testcontainers.properties`, or at the default sockets, and it does not read Docker contexts. On the Mac of the trial, `/var/run/docker.sock` points at Docker Desktop's socket, which does not exist while OrbStack runs, so Testcontainers reported every strategy as not applicable until `DOCKER_HOST` named OrbStack's socket. GitHub's Ubuntu runners have `/var/run/docker.sock`. Task 8.5 documents the variable.
- Testcontainers depends on `ssh2`, whose install script runs `node install.js`, and through it on the optional `cpu-features`, whose install script runs `node buildcheck.js > buildcheck.gypi && node-gyp rebuild`. Bun's default list of trusted dependencies lets both run, so with a failing `node` first on `PATH`, `bun install --frozen-lockfile` exits 1. `bun install --ignore-scripts`, as CI installs, or an empty `trustedDependencies` in `package.json` skips both without a `node` call; the scripts only build optional native bindings for SSH connections. An empty `trustedDependencies` also skips the `workerd` postinstall that a local install runs today (Decision 7 of `add-ci-baseline`). Task 5.3 makes the choice when it adds the package: without it, a local install runs Node where Node is installed, and fails under a failing `node` first on `PATH`.
- StrykerJS 10.1.1 printed a mutation score for `packages/core`: 100%, with all 17 mutants killed by its 7 tests in test runner processes that Bun forked. It needed the four changes below, which task 8.3 carries over.
- The repository's installs use Bun's isolated layout, which keeps `@stryker-mutator/core` under `node_modules/.bun`, and Stryker looks for `@stryker-mutator/*` plugins beside its own folder, so it found no Vitest runner. `plugins` names the runner by its path, `./node_modules/@stryker-mutator/vitest-runner/dist/src/index.js`.
- Stryker rewrites `tsconfig.json` in its sandbox with `ts.parseConfigFileTextToJson`, which TypeScript 7.0.2 no longer exports, whatever the runtime. `tsconfigFile` names a file that does not exist, which skips the rewrite, and the sandbox keeps the repository's layout, so the paths in the tsconfig files stay valid.
- Bun's native `Error.prepareStackTrace` throws "First argument must be an Error object" when a JavaScript wrapper hands it an object that only inherits from Error. This is oven-sh/bun#41151, open since 2026-09-02, and an eight-line script still reproduces it on Bun 1.4.5 of 2026-11-19. Loading `@stryker-mutator/core` installs `@babel/core`'s wrapper, and the Vite 8.3.8 that the Vitest runner loads builds such objects for the follow-redirects errors it bundles, so Stryker's main process could not load the runner, and the test runner processes then found no runner plugin. A preload that calls the native function, and formats the frames itself when it throws, lets the runner load. Only the main process needs it: `bun --bun --preload <file> node_modules/@stryker-mutator/core/bin/stryker.js run` scored the same, and the forked processes loaded the runner without it. Without the preload the run fails. The preload:

  ```js
  const native = Error.prepareStackTrace;
  if (typeof native === "function") {
    Error.prepareStackTrace = function prepareStackTrace(error, frames) {
      try {
        return native(error, frames);
      } catch {
        return [String(error), ...frames.map((frame) => `    at ${frame}`)].join("\n");
      }
    };
  }
  ```
- Stryker also needs a Vitest configuration that lists the package's tests. `vitest.dir` with the root configuration found none, because the root's patterns start at the repository root. With such a configuration, `vitest.related` can stay on.

Testcontainers therefore runs on Bun as it is. StrykerJS runs on Bun only with the preload, so, as task 1.1 asks, the owner chooses before groups 5 and 8 start: keep the preload in Stryker's main process until a Bun release fixes oven-sh/bun#41151, or wait for that release, which leaves task 8.3, the requirement "Weekly mutation testing" and the StrykerJS row of PRD §11 open without a date. Task 1.1 stays open until the owner has chosen.

## Differences between Cloudflare Workers and Bun

| Aspect | Workers | Bun |
| --- | --- | --- |
| Adapters | Durable Objects through RPC; R2 and S3-compatible storage through the object-store adapter, R2 by binding and S3 through the AWS SDK over `fetch` | The object-store adapter with the S3 driver only; Durable Objects and R2 backends answer with an unsupported-runtime error |
| Subrequests | Each S3 call is an external subrequest, at most 50 per invocation on Free; each R2 call counts toward 1,000 | No platform limit |
| Database | D1, with no interactive transactions and at most 50 queries per invocation on Free | Bun SQLite |
| Instance secret | The Workers secret `DAVLOOM_SECRET` | The environment variable `DAVLOOM_SECRET` |
| Upload bodies | A `FixedLengthStream` of the stated size, which R2 and S3 requests need | The adapter's counted stream, sent with `ContentLength` |
| Storage limit | 1 GB per Durable Object and 5 GB per account on Free | The S3-compatible storage's own |
| Where the tests run | The workerd pool of `@cloudflare/vitest-plugin` | `bun --bun vitest` |
| Bend modules | The same `.mjs` files, bundled by Wrangler; their CPU counts toward the request's budget | The same `.mjs` files |

## Logic that decides an outcome without IO

| Logic | Module | Laws |
| --- | --- | --- |
| The tree each namespace operation leaves | `namespace.bend` | `keeps_valid` |
| The outcome of each operation given its facts, with the order of errors | `namespace.bend` | `decides_in_order` |
| Whether a path keeps the rules of paths and names | `namespace.bend` | `accepts_valid_paths` |
| Whether a destination lies inside its source | `namespace.bend` | `keeps_valid` and `decides_in_order` depend on it |
| Whether a copy or a move would make a path too long | `namespace.bend` | `keeps_valid` and `decides_in_order` depend on it |
| Mapping paths to keys and reading keys back | `objects.bend` | `keys_round_trip` |
| Reading a listing into entries, with hidden keys and files | `objects.bend` | `listings_are_trees` |
| Whether a collection holds hidden objects, and whether a write is too large | `objects.bend` | `decides_object_outcomes` |
| Which field of a backend configuration is missing or invalid, and whether the instance secret is long enough | `backends.bend` | `accepts_valid_fields` |

Left in TypeScript, each with its reason:

- Reading each field of a backend configuration with Effect Schema as missing, of the wrong type, or a value. It parses untrusted input at the boundary, and `backends.bend` decides what each reading means.
- Splitting a stream into chunks and counting its bytes. The work is the stream itself.
- Turning provider failures, such as `SQLITE_FULL`, S3 error codes and network errors, into Port errors. The rules are the provider's, and they live in the infrastructure layer.
- Encryption and key derivation, which PRD §4 keeps in TypeScript on Web Crypto.
- Parsing an endpoint URL. The runtime's `URL` parser is the one that later sends the requests, and a second parser in Bend could disagree with it; Bend decides on the parsed parts.
- Refusing to remove a Durable Objects backend whose root is not empty. It compares the result of one query with nothing, and no rule is left once that IO is done.
- The `laws-approved` decision and the requirement coverage matching. They are CI scripts, and the owner decided on 2026-11-16 that the proofs cover shipped code in `apps/` and `packages/`.
- How `bun run laws:setup` validates `packages/laws/toolchain.json`, when its download resumes, retries or stops, and the checks it makes before an install: whether a path in the cache is in the way (`refuseInTheWay`), and whether a downloaded Lean reports the pinned version. It is a repository script, and the owner decided on 2026-11-16 that the proofs cover shipped code in `apps/` and `packages/`, not scripts.

## Risks / Trade-offs

- [Proofs in Bend take long, since it has no tactics or proof search] → An open law cannot merge, so each module's laws land with their proofs, and the modules and adapters can merge before the laws. Lemmas can land in `PROOF.bend` first (Decision 10).
- [The compiled modules cost too much CPU or bundle size on Workers] → Measure each module when it lands. Moving logic back to TypeScript needs a recorded exception and the owner's agreement.
- [Testcontainers or StrykerJS does not run on Bun] → Decision 15: try both first, and stop for the owner's choice if either fails.
- [The AWS SDK makes the Worker too large or slow to start, needs `nodejs_compat`, or uses too much of the 10 ms of CPU] → Measure size, startup time and the CPU of S3 calls in the contract Worker, and bring the numbers to the owner before changing the SDK.
- [Workers Free's subrequest limits cut copies and moves short on Workers] → A copy or move of more than about 40 objects with S3, or about 400 with R2, can fail in the middle. Removing is not affected, since it deletes 1,000 keys per call. The contract trees stay small, and Phase 2 sets the synchronous limit.
- [Local workerd does not apply the 1 GB limit] → The contract test simulates a full object, and one run on a real Workers Free deployment, approved by the owner beforehand, confirms the limit and that removing still works.
- [RustFS refuses keys that AWS S3 and R2 accept] → Stores built like MinIO refuse keys with `.`, `..` or empty parts, and a key that is both a file and the parent of another key. The scenarios that need such keys run on the R2 driver in workerd, the property tests of `objects.bend` cover every key, and the keys RustFS refused are recorded here. RustFS also refuses names over 255 bytes, which the name rule of Decision 3 already forbids; a Windows user's name of more than 85 CJK characters is refused with it.
- [RustFS does not keep an old object readable while it is replaced] → "A download during a replace" runs on every adapter; if it fails on RustFS, the owner decides before the S3 driver ships.
- [R2 is checked only on Miniflare] → Its behavior during a replace and its upload limit are not confirmed on Cloudflare. A real R2 run needs R2 enabled on the account, which needs a payment method, so it waits for the owner.
- [Two writers on R2 or S3 can give a name both a file and a marker] → Out of scope; the conflict checks of PRD §5 handle concurrent writers.
- [A pull request can rewrite the `laws-approved` check that judges it] → PRD §11 rules out the trigger that would prevent it. The check guards its own files, and the independent review catches a weakened guard (Decision 11). The owner decides whether to accept this or to make an exception to PRD §11 for this one workflow, which would also need an Actions event policy that allows it.
- [Every new head commit drops the laws approval, including GitHub's stack rebases] → Pull requests that change `LAWS.bend` are opened only once the pull requests below them have merged, and four pull requests need the label, once for each of their heads.
- [The prototype's sample data shows Durable Objects at 1.9 GB of 5 GB] → After the owner's decision a Durable Objects backend holds 1 GB. The specs of `dashboard-overview` and `dashboard-storage-mounts` keep the sample until the change that connects the Dashboard to the API shows real capacities, unless the owner asks to change it now.

## Migration Plan

Migration `0001` adds `storage_backends`, and the upgrade test covers databases made by `0000`. Nothing in production reads the table yet, so a rollback reverts the commits; a database already migrated keeps an unused table. Nothing new is deployed to Cloudflare.

## Open Questions

- The synchronous limit of directory COPY and MOVE for S3-compatible storage on Workers and on Bun, which Phase 2's protocol design sets beside the limits for Durable Objects and R2.
- Whether Better Auth's secret should derive from `DAVLOOM_SECRET` too, which Phase 3 decides with the rest of identity.
- Whether copies inside a Durable Objects backend should share their bytes, if copies turn out to fill backends.

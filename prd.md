# Davloom — Product and Engineering Plan

**Version:** v1.4  
**Date:** November 7, 2026  
**Type:** Open-source · Self-hosted · WebDAV · Cloud Storage  
**Product tagline:** *Your storage. Your rules.*  
**Architecture principle:** Cloudflare-first, Vendor-neutral by design.

---

## 1. Product Positioning

Davloom is an open-source, modern, self-hostable WebDAV file storage platform.

Users can turn storage such as Cloudflare Durable Objects, Cloudflare R2, AWS S3 and RustFS into a standard WebDAV service, and use a modern Web Dashboard to manage files, accounts, credentials and storage. A free Cloudflare deployment stores file content in Durable Objects by default and needs no payment method.

### Core Principles

- **Free-first:** Support the Cloudflare Free plan first.
- **Vendor-neutral:** Do not depend on the proprietary runtime capabilities of any single cloud vendor.
- **Self-hostable:** Support Docker, Bun and SQLite.
- **WebDAV-first:** Protocol correctness comes first.
- **Type-safe:** TypeScript + Effect Schema + Drizzle.
- **Proof-backed:** Logic that decides an outcome without IO is written in Bend 2 and proven, not only tested.
- **Secure-by-default:** Private storage and least privilege by default.
- **Portable:** Support migration of configuration, databases and file data.
- **Agent-friendly:** Code structure, component conventions and documentation are easy for AI coding agents to understand.

### Target Users

1. Developers who need to sync configuration over WebDAV.
2. Individual users who want to use Cloudflare for free, without adding a payment method.
3. Self-hosting users who own a NAS, home server or VPS.
4. Users who want to manage different S3-compatible storage in one place.

V1 is not positioned as a full replacement for Nextcloud. It mainly addresses WebDAV, file management and storage portability.

---

## 2. Full Tech Stack

### Frontend and UI

| Category | Choice |
|---|---|
| Programming Language | TypeScript |
| Frontend Framework | React 19+ |
| Full-stack Framework | TanStack Start |
| Router | TanStack Router |
| Server State | TanStack Query |
| Client State | TanStack Store |
| UI Design System | **Meta Astryx** |
| Styling | **Meta StyleX** |
| Theme | Astryx Theme System |
| Design Tokens | CSS Custom Properties + StyleX |
| Large List Virtualization | TanStack Virtual |
| Icons | Lucide |
| Build Tool | Vite |
| Styling Integration | @stylexjs/unplugin |
| UI Testing | Vitest + Playwright |

**Tailwind CSS, shadcn/ui and Radix UI are no longer listed as base project dependencies.**

Astryx provides React components, layout primitives, themes and interaction capabilities; StyleX styles Davloom's own components.

Complex file management components can combine TanStack Table, TanStack Virtual and the project's own interaction logic on top of Astryx.

### Backend and Domain Logic

| Category | Choice |
|---|---|
| HTTP Framework | ElysiaJS 1.4 (starting version chosen in Phase 0; reassess once 2.0 is officially released) |
| Business Framework | Effect v4 |
| Dependency Injection | Effect Context / Layer |
| Validation | Effect Schema |
| Error Handling | Effect Typed Errors |
| Typed API Client | Eden Treaty |
| API Documentation | OpenAPI |
| WebDAV Protocol | RFC 4918 |
| XML Parsing | saxes |
| Streaming | Web Streams API |
| Cryptography | Web Crypto API |

Elysia handles the HTTP entry point and Effect handles business orchestration. Their responsibilities do not overlap.

### Identity and Permissions

| Category | Choice |
|---|---|
| Authentication | Better Auth |
| ORM Adapter | Drizzle |
| Sessions | Better Auth |
| API Credentials | Better Auth API Key |
| Admin Management | Better Auth Admin |
| MFA | Better Auth Two-Factor |
| WebDAV Authentication | Basic Auth + API Key Adapter |
| Authorization | Effect Policy Service |

Better Auth manages identity centrally, while Effect decides file path and Mount permissions.

### Data and Storage

| Category | Choice |
|---|---|
| ORM | Drizzle ORM |
| Migration | Drizzle Kit |
| SQL Dialect | SQLite |
| Cloud Database | Cloudflare D1 |
| Self-hosted Database | Bun SQLite |
| Cloud Storage (default) | Cloudflare Durable Objects (SQLite backend) |
| Cloud Storage (optional) | Cloudflare R2 |
| Generic Storage | S3-compatible API |
| Storage SDK | AWS SDK S3 Client |
| Native Optimization | R2 Binding |
| File Locks | SQL-backed LockService |
| Optional Coordination | Durable Objects |

### Engineering Quality

| Category | Choice |
|---|---|
| Package Manager | Bun |
| Monorepo | Bun Workspaces |
| Linter | Oxlint |
| Formatter | Oxfmt |
| Type Check | TypeScript 7 (native `tsc`) |
| Unit Tests | Vitest |
| Workers Integration | @cloudflare/vitest-plugin |
| E2E | Playwright |
| Formal Verification | Bend 2 (`LAWS.bend` + `PROOF.bend`, checked by `bend PROOF.bend`, plain and with `--verdict`) |
| CI/CD | GitHub Actions |
| Security | CodeQL + OSV-Scanner + Gitleaks |
| Dependency Updates | Renovate |
| Release | Changesets |
| Container | Docker + Docker Compose |
| Spec Workflow | OpenSpec |
| Issue Tracking | Linear |
| Code Intelligence | GitNexus |

---

## 3. Astryx + StyleX Design Guidelines

### 3.1 Component Strategy

Davloom uses Astryx as its UI foundation instead of building another general-purpose component library.

Prefer:

- Astryx interactive components such as Button, Input, Dialog and Menu.
- Astryx layout features such as Layout, Stack and Grid.
- Astryx form, navigation and notification components.
- Astryx's existing design tokens and theme system.
- Custom StyleX styles for Davloom-specific components.

Do not reimplement general-purpose components that Astryx already provides.

### 3.2 Theme Design

Use `@astryxdesign/theme-neutral` by default.

On top of it, define the Davloom Theme:

- Brand Colors
- Typography
- Border Radius
- Spacing
- Surface Colors
- Semantic Colors
- Light / Dark Mode

Manage the theme through the Astryx Theme System and CSS Custom Properties.

Do not modify the source code of the Astryx dependency directly.

### 3.3 StyleX Usage Rules

Use StyleX first for all newly developed application-level components.

Conventions:

- Define component styles with `stylex.create()`.
- Compose styles with `stylex.props()`.
- Use Astryx design tokens wherever possible.
- Avoid arbitrary inline styles.
- Avoid introducing a second CSS-in-JS library in business components.
- Do not depend on Astryx's generated class names.

### 3.4 Build Method

Astryx uses its official precompiled CSS.

A Vite plugin compiles Davloom's own StyleX.

Keep Astryx's official CSS layers and theme order to avoid CSS conflicts caused by repeated compilation.

### 3.5 Avoiding UI Vendor Lock-in

Astryx is an open-source design system, but the UI still has a technical dependency on it.

Therefore:

- Business state must not be coupled to the internal implementation of Astryx components.
- File operations, permissions and data requests do not belong in general-purpose UI components.
- Custom business components receive data and operations through explicit props.
- The theme is based on exportable design tokens.
- For components that need deep customization, Astryx Swizzle can provide the source code, which Davloom then maintains itself.
- Pin a tested Astryx version so that beta API updates do not break the application.

Do not wrap every Astryx Button just for the sake of abstraction. Create stable interfaces only at business component boundaries.

### 3.6 AI Agent Development Guidelines

Use the Astryx CLI to get official component reference material, and include the component usage guidelines in the project's `AGENTS.md`.

AI coding agents must search the existing Astryx components first and must not create duplicate UI primitives at will.

The project needs a single set of documentation for design examples, theme variables and component usage.

---

## 4. System Architecture

Davloom follows Hexagonal Architecture and uses Effect Layers.

### Presentation Layer

- TanStack Start Dashboard
- Elysia REST API
- Elysia WebDAV HTTP Adapter

### Application Layer

- FileService
- DirectoryService
- TransferService
- MountService
- CredentialService
- PermissionService

### Domain Layer

- WebDAV Protocol Engine
- Storage Port
- Database Port
- Lock Port
- Effect Schema
- Domain Errors
- Authorization Policies
- Proven Domain Rules (Bend 2)

### Infrastructure Layer

- Cloudflare Durable Objects Storage Adapter
- Cloudflare R2 Adapter
- Generic S3 Adapter
- Cloudflare D1 Adapter
- SQLite Adapter
- SQL Lock Adapter
- Cloudflare Workers Runtime
- Bun Runtime

### Dependency Rules

1. Domain never depends on a cloud vendor SDK.
2. Elysia routes never touch storage backends or D1 directly.
3. TanStack Start never reads the database directly.
4. Effect Services reach infrastructure through Ports.
5. Every Adapter must pass the shared contract tests.
6. Cloudflare-only features appear only in the Infrastructure Layer.

### Proven Domain Logic

Davloom proves as much of its logic as Bend 2 can express. Every rule that decides an outcome without doing IO is written in Bend: `LAWS.bend` states its laws and `PROOF.bend` proves them. `bend <module>.bend -o <module>.mjs` compiles a module to JavaScript, and the TypeScript packages call that output, so the code that runs is compiled from the code that was proven. Phase 1 adds `packages/laws`, a pinned Bend release and the CI checks.

| Phase | Logic | Example laws |
|---|---|---|
| Phase 1 | Namespace model: MKCOL, PUT, DELETE, COPY and MOVE on a file tree | Every entry except the root has a parent, names are unique within a directory, and no operation creates a cycle. The Storage Contract Tests check every Adapter against this model. |
| Phase 2 | Path normalization, name validation and Mount resolution | Normalizing a normalized path changes nothing, and no input resolves outside its Mount root. |
| Phase 2 | COPY and MOVE: `Depth`, `Overwrite`, `Destination` and the synchronous limit | A request over the limit executes nothing, and a collection is never copied or moved into itself. |
| Phase 2 | Recovery of multi-object operations | A failure at any step never leaves a file missing from both the source and the destination, and running recovery again changes nothing. |
| Phase 2 | Conditional requests and HTTP Range | Preconditions are evaluated in the order RFC 9110 sets, and every returned range lies inside the resource. |
| Phase 3 | Permission decisions in the Policy Service | Access is denied unless a credential grants it, a credential never reaches outside its Mount and path prefix, a Read Only credential never writes, and an unauthorized cross-Mount operation is always denied. |
| Phase 5 | Class 2 locks and the lock tokens in the `If` header | For any sequence of LOCK, UNLOCK, refresh and write requests, a write to a locked resource without its token fails, and conflicting locks never exist at once. |
| Phase 6 | Data export and import plans | Every exported entry is imported exactly once, and a failed validation leaves the target unchanged. |

The laws also run as fast-check property tests against each compiled module. The proofs hold for Bend's semantics, and these tests check that the JavaScript backend keeps them.

Rules:

- **TypeScript keeps only what Bend cannot do.** IO and integration code stays in TypeScript: storage and database Adapters, Elysia routes, Better Auth, XML parsing, streaming, cryptography and the UI. Pure logic stays in TypeScript only when Bend cannot express it or cannot meet the Workers CPU budget. The OpenSpec design of that change records the reason, and fast-check property tests check the same laws.
- **The owner approves every law.** An AI agent may propose a law, but each change to `LAWS.bend` needs the owner's approval. GitHub does not let the owner approve a pull request they opened, so the approval is the `laws-approved` label: a required check fails on any pull request that changes `LAWS.bend` until the owner adds that label after its last commit, and the check reads from the pull request's events who added it. A law is never weakened or deleted to make a proof pass.
- **Both checkers must pass.** `bend PROOF.bend` must print ALL PROOFS CHECK, and so must `bend PROOF.bend --verdict`. The second run rechecks every proof with a small kernel that has a proof in Lean, and it refuses proofs that rely on `@unsafe` or foreign code. That kernel is a Lean program, so `--verdict` needs the Lean release that the Bend release names (Lean v4.34.0 for Bend v2.0.40), or a kernel built earlier and named by `$BENDTT`.
- **The boundary stays thin.** Effect Services call the compiled modules through typed wrappers that convert values at the boundary. An array passed to a Bend function is the caller's own array and may be updated in place, so a wrapper copies it whenever the caller keeps it. Bend does not yet write TypeScript declarations ([bendlang/bend#1144](https://github.com/bendlang/bend/issues/1144)), so each wrapper declares its module's types and its tests check them.
- **Numbers are Nat or U32.** Nothing about F32 can be proven in Bend, so proven rules never depend on floating point. Sizes, offsets and timestamps use Nat, which reaches JavaScript as a plain number. Bend stops with an error when a Nat passes 2^48 − 1 and rejects host numbers above 2^53, so the wrappers bound client values such as `Range` offsets and `Content-Length` before calling Bend, and turn any error Bend throws into a typed error.
- **Shipped Bend code does no IO.** The JavaScript output carries only non-IO defs, and Davloom adds no foreign JavaScript to its Bend code.

---

## 5. WebDAV Protocol

### V1 Target Support

| HTTP Method | Function |
|---|---|
| OPTIONS | Protocol capability advertisement |
| GET / HEAD | File reads and metadata |
| PUT | File upload |
| PROPFIND | File and directory property queries |
| MKCOL | Directory creation |
| DELETE | File and directory deletion |
| COPY | Copy |
| MOVE | Move and rename |
| PROPPATCH | Custom property modification |
| LOCK / UNLOCK | File locks |

Deliver the behavior that basic WebDAV Class 1 requires first, then complete locks and Class 2 compatibility.

Class 2 (LOCK / UNLOCK) is a V1 release gate: when the server does not support locks, macOS Finder can only mount read-only.

Never advertise a protocol capability that is not yet implemented correctly.

### Core Requirements

- Unicode file names and URL encoding.
- ETag and conditional requests.
- HTTP Range.
- Directory prefix emulation.
- Custom property persistence.
- Failure recovery for multi-object operations.
- Path normalization and path traversal protection.
- Streaming upload and download.
- Conflict checks for concurrent writes.
- SQL-backed locks and lock renewal.

Object storage has no atomic directory move, so COPY/MOVE needs an explicit strategy for partial failure and recovery.

Directory COPY/MOVE has a synchronous processing limit: the default Durable Objects storage handles at most 1000 objects at a time, and R2 at most 400. Above the limit there is no partial execution, and the server returns a clear error. The Durable Objects limit comes from Phase 0 measurements: one copy-and-delete of 2000 objects used 91 ms of CPU and wrote 14,000 rows, so 1000 objects write about 7000 rows, which is 7% of the Free plan's daily write quota. The R2 limit is estimated from 1000 internal subrequests per request and must be confirmed by measurement once R2 is enabled. The response code and how `operation_jobs` runs are decided in the WebDAV protocol design.

Every rule in this section that decides an outcome without IO, from path normalization to locks, is proven in Bend 2; see Proven Domain Logic in §4.

---

## 6. Authentication & Authorization

### Better Auth

Provides:

- Admin initialization
- User login
- Session
- API Key
- Credential expiry and revocation
- Optional MFA
- Admin account management

Public registration is disabled by default.

### WebDAV

Clients supply a username and a dedicated API Key through HTTPS + Basic Auth.

Elysia parses the authentication information, Better Auth verifies the credential, and Effect decides whether the corresponding file, directory and Mount may be accessed.

The administrator's primary account password must not be the default way to authenticate over WebDAV.

### Permission Model

V1 supports:

- Admin
- Read Only
- Read / Write
- Mount Scope
- Path Prefix Scope

V1 has only one admin account, with multiple client credentials and multiple Mounts, and no multi-user support. Read Only, Read / Write, Mount Scope and Path Prefix Scope are all bound to the API Key credential. Multi-user support is deferred to V2.0.

The Policy Service's decisions are proven in Bend 2; see Proven Domain Logic in §4.

---

## 7. Database and Persistence

### Better Auth Tables

Better Auth and the Drizzle Adapter maintain these tables. Davloom does not make its own copy of the authentication data model.

### Davloom Tables

| Table | Purpose |
|---|---|
| storage_backends | Storage backend configuration |
| mounts | Mount-to-prefix mapping |
| mount_permissions | Mount and path permissions for API Key credentials |
| dav_properties | WebDAV custom properties |
| dav_locks | File locks |
| operation_jobs | Copy and move jobs |
| settings | Instance configuration |
| audit_events | Security and operation auditing |

No mandatory full file index is built by default.

Directory listings come from the storage backend. A rebuildable index is introduced when search capability is needed.

The Durable Objects backend stores paths and file chunks in separate tables in the SQLite database inside each object, with each chunk row at most 2 MB. The table schema is decided in Phase 1.

### Data Migration

Supports:

- D1 → SQLite
- SQLite → D1
- Durable Objects → R2 or S3-compatible Storage
- R2 → S3-compatible Storage
- S3-compatible Storage → R2

Migration must cover objects, permissions, metadata and integrity checks.

Sensitive credentials must not be exported in plaintext.

---

## 8. Dashboard Features

### 8.1 Overview

Shows:

- Current storage backend
- Mount list
- Object count and known capacity
- WebDAV address
- Storage connection status
- Recent operation errors

Use the Astryx Dashboard Layout.

### 8.2 File Explorer

Build the file manager with Astryx + TanStack Virtual.

Features:

- File list
- Directory navigation
- Drag-and-drop upload
- File download
- Create directories
- Rename
- Move and copy
- Batch delete
- Sort and search
- File properties
- Text preview
- Loading and error states

Large file lists use pagination, virtualization and on-demand reads.

### 8.3 Credentials

- Create WebDAV API Keys
- Name and manage credentials
- Set a validity period
- Set read-only permission
- Restrict by Mount or path
- Revoke credentials

### 8.4 Storage & Mounts

- View backend storage
- Manage buckets and prefixes
- Create Mounts
- Edit Mounts
- Verify connections
- View basic storage information

### 8.5 Settings

- Profile
- Authentication
- Appearance
- WebDAV Settings
- Storage Configuration
- Data Export
- Instance Information

Supports three appearance modes: Light / Dark / System.

---

## 9. Deployment Options

### Cloudflare Free

Uses by default:

- TanStack Start Web
- Elysia Worker
- D1, for metadata
- Durable Objects (SQLite backend), for file content

The Dashboard prefers SPA Mode to reduce SSR runtime cost.

R2 and S3-compatible services are optional backends that users can choose. Enabling R2 goes through a checkout flow, and usage beyond the free allowance is billed, so the default deployment does not depend on it. KV is not used.

Worker CPU and request counts on Cloudflare Free, and CPU and write quotas for Durable Objects, must be confirmed by measurement on a real deployment.

Limits stated in the official documentation (checked in November 2026):

- **Request body limit of 100 MB (Free / Pro domains):** A WebDAV PUT above the limit returns 413. V1 documents it as an explicit Cloud Free limit. Chunked upload for large files in the Dashboard will be evaluated separately.
- **10 ms of CPU per HTTP request:** Tests must cover the full request path, including authentication. Phase 0 measured this on Workers Free (2026-11-06) and did not hit the limit: a request that used 1134 ms also succeeded, and admin login in the Worker took 63–94 ms. The documentation does not promise this leniency, so the design still leaves a margin against 10 ms.
- **30 seconds of CPU per Durable Objects request:** This row does not distinguish between plans, but the same page also says the Workers limits apply, so the default storage choice must be confirmed by Phase 0 measurement. The measurement confirmed that it holds on Free: a request that used 32.3 seconds of CPU completed, and the next request was reset at about 30.2 seconds and returned 502.
- **Durable Objects Free quota:** Only the SQLite backend is available. Limits are 1 GB per object, 5 GB in total and 2 MB per row; per day, 100,000 requests, 13,000 GB-s, 5 million rows read and 100,000 rows written (deletes also count as writes). Going over a quota returns an error and is not billed.
- **D1 Free quota:** 500 MB per database, 5 GB in total and 2 MB per row; at most 50 queries per invocation, and per day 5 million rows read and 100,000 rows written.
- **At most 50 external subrequests and 1000 internal subrequests per invocation:** R2 calls count as internal subrequests, so the synchronous processing limit for directory COPY/MOVE is set to 400 objects when R2 is used.
- **R2 `ListObjects` is Class A, with a free allowance of 1 million operations per month:** When R2 is used, every directory PROPFIND consumes this allowance.

### Docker Self-hosted

Uses:

- Bun
- TanStack Start
- Elysia
- SQLite
- S3-compatible Storage
- Optional RustFS

Docker Compose provides the standard deployment entry point.

It needs no Cloudflare account at all.

### Hybrid

The runtime, database and storage backend can each be replaced independently.

Cloudflare Service Binding can serve as a platform optimization, but a standard HTTP communication path must also be provided.

---

## 10. Monorepo

```text
davloom/
├── apps/
│   ├── web/                # TanStack Start
│   │   └── src/
│   │       ├── routes/
│   │       ├── features/
│   │       │   ├── explorer/
│   │       │   ├── credentials/
│   │       │   ├── mounts/
│   │       │   └── settings/
│   │       ├── components/
│   │       ├── styles/     # StyleX
│   │       └── providers/
│   └── api/                # ElysiaJS
│
├── packages/
│   ├── core/               # Effect
│   ├── laws/               # Bend 2 code, laws and proofs
│   ├── schema/             # Effect Schema
│   ├── webdav/             # WebDAV Protocol
│   ├── auth/               # Better Auth
│   ├── client/             # Eden Treaty
│   ├── database/
│   ├── storage/
│   └── ui/                 # Davloom UI
│       ├── components/
│       ├── tokens/
│       ├── themes/
│       └── styles/
│
├── deploy/
│   ├── cloudflare/
│   └── docker/
│
├── tests/
│   ├── unit/
│   ├── contracts/
│   ├── webdav/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── architecture/
│   ├── development/
│   ├── design-system/
│   ├── deployment/
│   └── security/
│
├── openspec/               # OpenSpec specs and changes
│   ├── config.yaml
│   ├── specs/
│   └── changes/
│
├── .claude/                # Claude Code commands and skills for OpenSpec and GitNexus
├── .github/
├── AGENTS.md
├── CLAUDE.md
├── prd.md
├── package.json
├── bun.lock
├── tsconfig.json
├── oxlint.json
└── README.md
```

`packages/ui` holds only shared Davloom business components, themes and design tokens. It does not copy all of Astryx.

`packages/laws` holds the Bend 2 modules with their `LAWS.bend` and `PROOF.bend`, and the typed wrappers through which the TypeScript packages call the compiled modules.

---

## 11. CI/CD

CI is added in layers that follow the phases, not all at once. The `tasks.md` of each phase includes a task to wire its new tests into CI. The detailed plan for the baseline is in the OpenSpec change `add-ci-baseline`. The repository has been public since it was created, because on a free account Rulesets, CodeQL and native secret scanning all require a public repository.

### Rollout Plan

| When It Runs | Contents | Added |
|---|---|---|
| Repository setup | GitHub Rulesets, CODEOWNERS, Renovate | After Phase 0 |
| Required on PR | Frozen Lockfile, Oxlint + tsgolint, Oxfmt, TypeScript Typecheck, Vitest, Workers and Bun compatibility tests, Playwright, Build Verification, OSV-Scanner, Gitleaks, CodeQL, actionlint, zizmor | After Phase 0 |
| Required on PR | Coverage gates per package (Vitest with Istanbul coverage), starting at the measured coverage | After Phase 0 |
| Required on PR | Effect Service Tests, Database Contract Tests, Storage Contract Tests (Vitest + Testcontainers + RustFS), database upgrade tests (D1 and SQLite) | Phase 1 |
| Required on PR | Bend 2 proof checks (`bend PROOF.bend`, plain and with `--verdict`), a rebuild of every compiled module, and fast-check property tests of the laws against the compiled modules | Phase 1 |
| Weekly, and required before release | StrykerJS on `packages/core` and `packages/webdav`, with a mutation score of at least 80% | Phase 1 |
| Required on PR | Requirement coverage: every OpenSpec scenario maps to at least one test | Phase 1 |
| Required on PR | WebDAV Protocol Tests (in-house RFC tests + litmus), rclone real-client tests, fast-check property tests (path normalization, the `If` header, XML limits) | Phase 2 |
| Required on PR | UI-specific tests | Phase 4 |
| Scheduled | Grafana k6, run only against local Bun or Docker, never against Cloud Free | Phase 5 |
| On release | Changesets, Wrangler, Docker Buildx, Trivy, Syft SBOM + license check, Artifact Attestations | Phase 6 |
| Before release | Cloud Free quota check, macOS Finder manual acceptance | Phase 6 |

Not adopted for now: oasdiff, Lighthouse CI, CodSpeed, Cosign. They will be added when there is a clear need.

The Cloud Free quota check asserts the number of D1 and Durable Objects calls per request in the Workers tests, and uses the values measured in Phase 0 as the CPU thresholds.

### Test Budget

Davloom has at least 8,000 unique test cases at V1, and the plan holds about 9,500. One `it` or `test` is one case, and each row of an `it.each` table is one case. A case runs once for every runtime, backend or browser in its matrix, so a full CI run executes about 18,300 cases.

The black-box layers run on four deployment combinations: Workers + D1 + Durable Objects (the Cloud Free default), Workers + D1 + R2, Workers + D1 + S3 (Hybrid), and Bun + SQLite + S3 or RustFS (the Docker default).

| Layer | Unique cases | Matrix | Executions |
|---|---|---|---|
| Unit: `packages/webdav` (headers, XML bodies, paths and encoding, the lock state machine, status codes and ETag) | 1,670 | 1 | 1,670 |
| Unit: `packages/core` (the exhaustive policy table of 1,440 cases, COPY/MOVE planning, `operation_jobs`, Mount resolution) | 2,190 | 1 | 2,190 |
| Unit: other packages | 400 | 1 | 400 |
| Property and fuzz: 60 fast-check properties and 200 fuzz regressions | 260 | 1 | 260 |
| Effect Services | 450 | 1 | 450 |
| Storage contract | 300 | 3 backends | 900 |
| Database contract and upgrade | 350 | 2 databases | 700 |
| WebDAV protocol, black-box | 1,240 | 4 deployments | 4,960 |
| Permissions and security, black-box | 1,190 | 2 runtimes | 2,380 |
| Concurrency and fault recovery | 200 | 4 deployments | 800 |
| Management API and quota | 340 | API on 2 runtimes, quota on 3 deployments | 720 |
| Real clients: rclone, cadaver and davfs2 | 130 | rclone on 4 deployments, the others on 2 | 420 |
| Data migration, in 5 directions | 300 | 1 | 300 |
| Browser E2E | about 410 | Up to 3 browsers × 3 viewports | about 2,040 |
| Runtime compatibility and release smoke tests | 110 | 1 | 110 |
| **Total** | **about 9,500** | | **about 18,300** |

The policy table is the product of 2 permissions, 4 scopes, 12 methods, 5 target relations and 3 Mount states. The security layer covers the whole 480-cell permission table, 80 path traversal payloads at each of the 6 entry points that take a path, XML attacks, authentication headers, resource exhaustion and log redaction. In the browser layer, 170 core flows run in Chromium, WebKit and Firefox at desktop, tablet and phone sizes; 130 other states run in desktop Chromium; screenshot tests cover 15 screens in both themes; and 36 more cases cover accessibility and large-list performance. litmus reports its results separately and does not count toward the budget.

Rules for tests at this size:

- Expected values come from an independent oracle: a small reference model, such as the one behind the policy table, or the text of RFC 4918 for the protocol tables. Tests never compare against snapshots of what the implementation returns.
- Cases come from data tables run with `it.each`, so reviews cover the tables and the models instead of thousands of functions.
- Modules that Bend proves are tested too: their tables run against the compiled JavaScript.
- HTTP and browser tests start their servers once per job and keep cases apart by Mount and path.

### Coverage Gates

| Code | Lines | Branches | Functions |
|---|---|---|---|
| `packages/webdav`, `packages/core` | 95% | 90% | 95% |
| `packages/auth`, `packages/database` | 90% | 85% | Not gated |
| `apps/api`, `apps/web`, `packages/ui` | 80% | 75% | Not gated |

- The table holds the V1 targets. Each package starts at the coverage measured when its gate is added, its thresholds rise every phase, and they reach the targets before V1.
- Thresholds only go up. Lowering one needs a reason in the `design.md` of the change that lowers it.
- Coverage comes from Istanbul instrumentation through `@vitest/coverage-istanbul`. Bun runs JavaScriptCore and workerd supports only instrumented coverage, so V8 coverage cannot measure Davloom's tests.
- StrykerJS keeps a mutation score of at least 80% on `packages/core` and `packages/webdav`. It runs weekly and must pass before a release.
- From Phase 1, requirement coverage is a required check: every OpenSpec scenario maps to at least one test whose name carries the scenario's ID, and the check fails when a scenario has none. Scenarios that need a real deployment or manual verification are listed with how they were verified.

### Tooling Choices

- **Renovate, not Dependabot:** Bun is not on the GitHub dependency graph's support list, so the graph cannot read `bun.lock`, and Dependabot alerts that rely on the graph cannot see the transitive dependencies in the lockfile. Renovate can refresh `bun.lock` on a schedule (Lock File Maintenance) and can use OSV data to propose security updates for direct dependencies. It opens a PR as soon as a new version is released, with no waiting period.
- **OSV-Scanner, not Dependency Review:** Dependency Review relies on the dependency graph and cannot see `bun.lock`.
- **Trivy scans only images, Dockerfiles and Compose files:** OSV-Scanner handles dependencies. In March 2026, 76 tags of `trivy-action` were force-pushed to code that steals credentials, so pin its version and checksum and run it in a job that has no secrets.
- **Gitleaks as a CLI, alongside GitHub native secret scanning:** The Gitleaks author has stated that they will only fix security issues.
- **No Cosign for now:** Artifact Attestations are themselves signed with Sigstore and can prove which workflow built an image.
- **Two approvals, which the owner can bypass:** A PR needs two approvals and every required check. The repository owner can bypass the approvals but not the checks, because an author cannot approve their own PR. CODEOWNERS names the owners without requiring code owner review.
- **Bend 2 proofs, not a separate Lean or TLA+ model:** A model written in another language can drift from the code, while Bend proves the module that Davloom runs. CI installs a pinned Bend release, verifies the archive against its sha256, and sets `BEND_NO_TELEMETRY=1` so that `bend` skips its daily version check. `--verdict` builds its kernel with Lean, so CI also installs the Lean release that the pinned Bend release names (v4.34.0 for Bend v2.0.40), verifies that archive against a checksum recorded in the repository, and caches the built kernel, which it passes to `bend` through `$BENDTT`. Both pins move together when Bend is upgraded.
- **AWS S3 stays out of CI:** It costs money and is only an optional backend for users. D1, Durable Objects and R2 can all be tested in the local Workers runtime without an account.

### Workflow Security

- Pin actions to a commit SHA.
- Each workflow declares the minimum `permissions`.
- Do not use `pull_request_target`.
- PR checks do not read cloud credentials or repository secrets.

### UI-Specific Tests

Add:

- Astryx Component Compatibility
- Light / Dark Mode
- Keyboard Navigation
- Accessibility
- StyleX Production Build
- CSS Layer / Theme Regression
- Large directory list performance tests

Run screenshot regression tests on key screens.

### Release Process

PR → Checks → Build → Preview → Integration Tests → Security Scan → Release → Smoke Test.

Supports SBOM, build attestations and version rollback.

---

## 12. Security Requirements

- Private buckets are enabled by default.
- WebDAV is exposed over HTTPS only.
- All file access is authorized.
- Secrets are kept in platform Secrets or persisted with encryption.
- API Keys are not kept in plaintext long term.
- Prevent path traversal.
- Limit XML body size and parsing complexity.
- Prevent recursive operations from exhausting resources.
- File reads and writes support conditional requests.
- Do not log sensitive authentication content.
- Unauthorized cross-Mount operations are denied by default.
- The rules behind path traversal protection, permission decisions, cross-Mount denial and locks are proven in Bend 2.

---

## 13. Eight-Week Development Plan

| Phase | Period | Goal |
|---|---|---|
| Phase 0 | Week 1 | Monorepo, framework, deployment and UI compatibility verification |
| Phase 1 | Week 2 | Effect Core, D1/SQLite, Durable Objects/R2/S3 |
| Phase 2 | Week 3 | Basic WebDAV protocol |
| Phase 3 | Week 4 | Better Auth, API Key, permissions |
| Phase 4 | Week 5 | Astryx + StyleX Dashboard |
| Phase 5 | Week 6 | WebDAV compatibility and file locks |
| Phase 6 | Week 7 | Docker, Cloudflare, data migration |
| Phase 7 | Week 8 | Testing, security, documentation, release |

A feature ships only when the laws it needs are proven (Proven Domain Logic, §4), so a phase is done when every law of the features it ships is proven.

### Phase 0 Must Verify

- Elysia + Effect on Cloudflare Workers.
- Better Auth + D1 / SQLite.
- TanStack Start + React 19.
- Integration of Astryx components with TanStack Start.
- StyleX compilation with Vite.
- Astryx Theme and Dark Mode.
- CPU and request overhead on Cloudflare Free, covering the full request path including authentication.
- The Durable Objects CPU limit and file writes on Cloudflare Free.
- WebDAV methods (OPTIONS, PROPFIND, MKCOL, COPY, MOVE, PROPPATCH, LOCK, UNLOCK) passing through Elysia, Workers and Bun.
- PUT and GET streaming end to end, without buffering the whole file in memory.
- The synchronous processing limit for directory COPY/MOVE on Cloud Free.
- The Elysia starting version (1.x stable or 2.0).

### Phase 4 UI Deliverables

Must be completed:

1. Astryx App Shell.
2. File Explorer.
3. Upload / Download UI.
4. Credentials page.
5. Storage / Mounts page.
6. Settings page.
7. Light / Dark Mode.
8. File operation status and error feedback.

All of it uses the same design tokens.

---

## 14. Key Risks

| Risk | Mitigation |
|---|---|
| Astryx beta API changes | Pin the version, component compatibility tests |
| StyleX + Vite integration issues | Verify the production build in Phase 0 |
| Gaps in Astryx component features | Compose existing primitives or Swizzle selectively |
| Workers Free CPU limit exceeded | SPA first, reduce CPU per request |
| Elysia Workers compatibility | Runtime Integration Tests |
| D1 / SQLite differences | Driver Contract Tests |
| Durable Objects does not get 30 seconds of CPU on Free | Phase 0 measurement; if that does not hold, the maintainer decides among options such as base64 chunking |
| Behavior differences between Durable Objects / R2 / S3 | Storage Capability Tests |
| WebDAV locks and concurrency | SQL Lock Tests, conservative capability advertisement |
| Large directory operations | Pagination, virtualization, recoverable jobs |
| Loss during cross-platform migration | Data validation and recovery tests |
| Bend 2 is young: its compiler is 99% AI-written and not yet fully audited, and releases can break JavaScript hosts | Pin the Bend release and the Lean release its `--verdict` kernel builds with, each with its checksum; read the CHANGELOG before each upgrade; and require `--verdict` |
| Proofs cover Bend's semantics, not the JavaScript backend | fast-check property tests run every law against the compiled modules |
| Proofs take effort, because Bend has no tactics or proof search | Keep laws small and prove them in phase order; an unproven law blocks only the feature that needs it |
| Compiled modules cost CPU or bundle size on Workers Free | Measure CPU per call and bundle size when each module lands; moving logic back to TypeScript needs a recorded exception |
| The test suite outgrows the CI time budget | Start servers once per job, shard the browser tests, cache installs, and compare each phase's run time with the estimate in `docs/ci.md` |

---

## 15. V1 Release Criteria

- [ ] Deployable on the Cloudflare Free plan.
- [ ] Runs standalone in Docker.
- [ ] The Astryx Dashboard is fully usable.
- [ ] The StyleX production build passes.
- [ ] Light / Dark Mode works.
- [ ] Better Auth login and API Keys work.
- [ ] Basic file and directory operations work.
- [ ] The basic WebDAV protocol passes its tests.
- [ ] WebDAV Class 2 (LOCK / UNLOCK) passes its tests, and macOS Finder can mount read-write.
- [ ] The Durable Objects, R2 and generic S3 Adapters work.
- [ ] The D1 and SQLite Adapters work.
- [ ] Permission control passes its tests.
- [ ] Concurrency and error recovery behavior is verified.
- [ ] Every law in `LAWS.bend` is proven: `bend PROOF.bend` and `bend PROOF.bend --verdict` both print ALL PROOFS CHECK.
- [ ] At least 8,000 unique test cases pass, each on every combination in its matrix.
- [ ] Coverage meets the V1 gates, and the mutation score of `packages/core` and `packages/webdav` is at least 80%.
- [ ] Every OpenSpec scenario maps to a passing test or to a recorded manual verification.
- [ ] Data export and migration pass their tests.
- [ ] Cloudflare / Docker Smoke Tests pass.
- [ ] No known Critical security vulnerabilities.
- [ ] Installation and architecture documentation is published.

---

## 16. Future Roadmap

### V1.1 — Reliability

Improvements to protocol compatibility, performance, failure recovery and file locks.

### V1.2 — Storage Expansion

More storage providers, the local file system and storage migration enhancements.

### V2.0 — Advanced Self-hosting

Multi-user support, teams, fine-grained permissions, PostgreSQL and optional distributed jobs.

---

## 17. Final Technical Decisions

**Davloom's official tech stack:**

- TypeScript + Bun
- React 19 + TanStack Start
- TanStack Router / Query / Store / Virtual
- **Meta Astryx + Meta StyleX**
- ElysiaJS
- Effect v4 + Effect Schema
- Better Auth
- Drizzle ORM
- SQLite + Cloudflare D1
- Cloudflare Durable Objects + S3-compatible Storage + Cloudflare R2 (optional)
- Oxlint + Oxfmt
- Vitest + Playwright
- Bend 2 for formal proofs
- GitHub Actions
- Cloudflare Workers + Docker

**Architecture:** Hexagonal Architecture + Effect Layers.

**Verification:** Bend 2 proves every rule that decides an outcome without IO; TypeScript calls the compiled modules, and tests cover the rest.

**Default deployment:** Workers + D1 + Durable Objects, with R2 optional.

**Portable deployment:** Bun + SQLite + S3-compatible Storage.

**Design system:** Astryx Components + StyleX + Davloom Theme.

**Development workflow:** OpenSpec (proposal → specs → design → tasks).

**Product goal:** An open-source WebDAV platform that works on a free plan, can be self-hosted, has no mandatory cloud vendor lock-in and has a modern file management experience.

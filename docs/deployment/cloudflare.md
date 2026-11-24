# Deploy on Cloudflare Workers Free

Davloom runs on the Workers Free plan without a payment method: the Worker serves the Dashboard and
WebDAV, D1 keeps the records (the administrator, API Keys, Mounts, locks), and each storage backend
is one SQLite-backed Durable Object that keeps file content in 1 MiB rows.

## Limits of the Free plan

| Limit                                               | What it means for Davloom                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| 100 MB request body                                 | A single upload is at most 100 MB; WebDAV PUT above it fails with 413.     |
| 1 GB per Durable Object                             | One storage backend holds about 1 GB. Add more backends for more.          |
| 5 GB of Durable Object storage per account          | All backends together.                                                     |
| 100,000 Durable Object rows written per day         | About 100 GB of uploads a day at 1 MiB a row, fewer with many small files. |
| D1: 5 million rows read and 100,000 written per day | API Keys are cached for 30 s, so a WebDAV client costs few reads.          |

R2 and S3-compatible backends are optional. Enabling R2 needs a payment method; Davloom offers the
R2 kind only when the Worker has an R2 binding.

## Steps

You need Bun and a Cloudflare account. From a clone of the repository, build the Dashboard first
(from the repository root, so the build runs on Bun):

```bash
bun install --frozen-lockfile
bun run --filter @davloom/web build
cd apps/api
bunx --bun wrangler login
```

`apps/api/wrangler.jsonc` describes the project's own deployment. Before you deploy your own, edit it:

- Delete the `routes` entry, which names the project's custom domain, or replace its `pattern`
  with a domain on your account. Without a route the Worker answers on `davloom.<you>.workers.dev`.
- Replace the D1 `database_id` with the id of the database you create next.

Create the D1 database and put its id into `apps/api/wrangler.jsonc` under `d1_databases`:

```bash
bunx --bun wrangler d1 create davloom
```

Apply the migrations and deploy:

```bash
bunx --bun wrangler d1 migrations apply davloom --remote
bunx --bun wrangler deploy
```

Set the secret. `DAVLOOM_SECRET` signs sessions and encrypts S3 secret keys; use at least 32
random bytes and keep it: changing it signs everyone out and makes stored S3 secret keys unreadable.

```bash
openssl rand -base64 48 | bunx --bun wrangler secret put DAVLOOM_SECRET
```

Open the Worker's address right after deploying and create your account: registration is open
only while the instance has no account, so the first visitor becomes the owner, and it closes for
everyone once the owner exists. Then create an API Key on Credentials and mount
`https://<worker>/dav/`. Registration creates a Durable Objects backend and the Mount `files`.

Davloom refuses passwords shorter than 12 characters and passwords that appear in known breaches,
which it checks with the Have I Been Pwned range API (`api.pwnedpasswords.com`; only the first
five characters of the password's SHA-1 hash leave the server). When that API cannot be reached,
Davloom refuses the new password with `password_check_failed` (503) rather than accept it
unchecked. `DAVLOOM_CHECK_LEAKED_PASSWORDS=off` (a plain variable) turns the check off, for an
instance without internet access.

`DAVLOOM_URL` (a plain variable) names the public address when the Worker answers on several, such
as a custom domain and `workers.dev`.

## Deploying from GitHub

`.github/workflows/deploy.yml` deploys every push to `main` once the repository has the secrets
`CLOUDFLARE_API_TOKEN` (Workers Scripts Edit, D1 Edit, Account Settings Read, and Workers Routes
Edit for a custom domain) and `CLOUDFLARE_ACCOUNT_ID`. Without them it succeeds without deploying.

## Smoke test

`scripts/smoke.ts` checks a running deployment end to end with one Read/Write API Key. It loads
the Dashboard, checks the setup state and the Basic challenge, and runs a WebDAV round trip:
a 1 MiB file, a byte range, a dead property, a lock and copy and move, in a new folder of the
first Mount that it deletes at the end.

```bash
DAVLOOM_SMOKE_KEY=dav_… bun scripts/smoke.ts https://davloom.example.com
```

The Deploy workflow runs it after each deploy when the repository has a `DAVLOOM_SMOKE_KEY`
secret and a `DAVLOOM_SMOKE_URL` variable. The same check runs against a Docker deployment, and
the compatibility tests run it against local workerd and the Bun and RustFS stack.

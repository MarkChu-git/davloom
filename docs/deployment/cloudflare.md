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

You need Bun and a Cloudflare account. From a clone of the repository:

```bash
bun install --frozen-lockfile
cd apps/api
bunx --bun wrangler login
```

Create the D1 database and put its id into `apps/api/wrangler.jsonc` under `d1_databases`:

```bash
bunx --bun wrangler d1 create davloom
```

Apply the migrations, build the Dashboard and deploy:

```bash
bunx --bun wrangler d1 migrations apply davloom --remote
bun run --filter @davloom/web build
bunx --bun wrangler deploy
```

Set the two secrets. `DAVLOOM_SECRET` signs sessions and encrypts S3 secret keys; use at least 32
random bytes and keep it: changing it signs everyone out and makes stored S3 secret keys unreadable.
`DAVLOOM_SETUP_TOKEN` is what the first-run setup asks for.

```bash
openssl rand -base64 48 | bunx --bun wrangler secret put DAVLOOM_SECRET
openssl rand -hex 16 | tee /dev/stderr | bunx --bun wrangler secret put DAVLOOM_SETUP_TOKEN
```

Open the Worker's address, finish the setup with the token, create an API Key on Credentials, and
mount `https://<worker>/dav/`. The setup creates a Durable Objects backend and the Mount `files`.

`DAVLOOM_URL` (a plain variable) names the public address when the Worker answers on several, such
as a custom domain and `workers.dev`.

## Deploying from GitHub

`.github/workflows/deploy.yml` deploys every push to `main` once the repository has the secrets
`CLOUDFLARE_API_TOKEN` (Workers Scripts Edit, D1 Edit, Account Settings Read, and Workers Routes
Edit for a custom domain) and `CLOUDFLARE_ACCOUNT_ID`. Without them it succeeds without deploying.

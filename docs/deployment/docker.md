# Self-host with Docker

The image runs Davloom on Bun with SQLite for its records and an S3-compatible store for files.
`deploy/docker/compose.yaml` starts it with RustFS; any S3-compatible store works.

## With RustFS

Create `deploy/docker/.env` (never commit it; the image build leaves it out):

```bash
DAVLOOM_SECRET=<at least 32 random bytes, e.g. from: openssl rand -base64 48>
DAVLOOM_SETUP_TOKEN=<a token for the first-run setup, e.g. from: openssl rand -hex 16>
RUSTFS_SECRET_KEY=<a password for RustFS>
# The address people open. For a first try on this machine, leave it out and open localhost.
# DAVLOOM_URL=https://files.example.com
```

Point Davloom at RustFS by adding these to the `davloom` service's environment in `compose.yaml`
(or to `.env` with matching `${…}` entries):

```yaml
DAVLOOM_S3_ENDPOINT: http://rustfs:9000
DAVLOOM_S3_ACCESS_KEY_ID: davloom
DAVLOOM_S3_SECRET_ACCESS_KEY: ${RUSTFS_SECRET_KEY}
```

Then start it and open `http://localhost:3000` (or the address in `DAVLOOM_URL`, which sign-in
then expects):

```bash
docker compose -f deploy/docker/compose.yaml up -d
```

On its first start Davloom creates the bucket `davloom` when it is missing, and the first-run setup
creates the backend `Default` on it with the Mount `files`. Put Davloom behind HTTPS (a reverse proxy
such as Caddy) before you expose it: WebDAV clients send the API Key with every request.

Davloom serves WebDAV and its API over plain HTTP only on the machine itself (`localhost`,
`127.0.0.1`, `::1`). From any other address it answers 403, unless a proxy in front of it sends
`X-Forwarded-Proto: https`, as Caddy and nginx can, or `DAVLOOM_ALLOW_HTTP=1` allows plain HTTP for
a trusted network. The health check `/api/health` answers either way.

## Settings

| Variable                                                   | Meaning                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `DAVLOOM_SECRET`                                           | Required. At least 32 bytes. Signs sessions and encrypts S3 secret keys.         |
| `DAVLOOM_SETUP_TOKEN`                                      | The token the first-run setup asks for. Without it, setup is closed.             |
| `DAVLOOM_URL`                                              | The public address, for sign-in cookies and redirects.                           |
| `DAVLOOM_DATA_DIR`                                         | Where SQLite keeps `davloom.sqlite`; `/data` in the image, a volume.             |
| `DAVLOOM_S3_ENDPOINT`                                      | The S3-compatible endpoint of the default backend, such as `http://rustfs:9000`. |
| `DAVLOOM_S3_ACCESS_KEY_ID`, `DAVLOOM_S3_SECRET_ACCESS_KEY` | Its credentials.                                                                 |
| `DAVLOOM_S3_BUCKET`                                        | The bucket; `davloom` unless set.                                                |
| `DAVLOOM_S3_REGION`                                        | `us-east-1` unless set.                                                          |
| `DAVLOOM_S3_PREFIX`                                        | A key prefix inside the bucket, ending at `/`; empty unless set.                 |
| `DAVLOOM_S3_FORCE_PATH_STYLE`                              | `false` for stores that want the bucket in the host name; true otherwise.        |
| `DAVLOOM_ALLOW_HTTP`                                       | `1` serves WebDAV and the API over plain HTTP to any address, for a trusted LAN. |
| `HOST`, `PORT`                                             | Where the server listens; `0.0.0.0:3000` in the image.                           |

More S3-compatible backends can be added later through the API (`POST /api/backends` with `kind:
"s3"`); their secret keys are stored encrypted with `DAVLOOM_SECRET`.

## Without Docker

```bash
bun install --frozen-lockfile
bun run --filter @davloom/web build
DAVLOOM_SECRET=… DAVLOOM_SETUP_TOKEN=… DAVLOOM_S3_ENDPOINT=… bun apps/api/src/entry.bun.ts
```

## Smoke test

Once setup is done and a Read/Write API Key exists, check the stack end to end from a checkout
of this repository:

```bash
DAVLOOM_SMOKE_KEY=dav_… bun scripts/smoke.ts http://localhost:3000
```

`docs/deployment/cloudflare.md` lists what it checks.

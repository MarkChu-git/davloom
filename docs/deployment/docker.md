# Self-host with Docker

The image runs Davloom on Bun with SQLite for its records and an S3-compatible store for files.
`deploy/docker/compose.yaml` starts it with RustFS; any S3-compatible store works.

## With RustFS

Create `deploy/docker/.env` (never commit it; the image build leaves it out):

```bash
DAVLOOM_SECRET=<at least 32 random bytes, e.g. from: openssl rand -base64 48>
RUSTFS_SECRET_KEY=<a password for RustFS>
# The address people open. For a first try on this machine, leave it out and open localhost.
# DAVLOOM_URL=https://files.example.com
# Optional: registration and import then ask for it (e.g. from: openssl rand -base64 32).
# DAVLOOM_SETUP_TOKEN=<a random token>
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

On its first start Davloom creates the bucket `davloom` when it is missing. Open it right after
starting and create your account: the first account becomes the owner, registration then closes
for everyone, permanently, and it creates the backend `Default` on the bucket with the Mount
`files`. Until then anyone who reaches the address could register first; set `DAVLOOM_SETUP_TOKEN`
to have registration and import ask for it. Put Davloom behind HTTPS (a reverse proxy
such as Caddy) before you expose it: WebDAV clients send the API Key with every request.

Davloom serves WebDAV and its API over plain HTTP only on the machine itself (`localhost`,
`127.0.0.1`, `::1`). From any other address it answers 403, unless a proxy in front of it sends
`X-Forwarded-Proto: https`, as Caddy and nginx can, or `DAVLOOM_ALLOW_HTTP=1` allows plain HTTP for
a trusted network. The health check `/api/health` answers either way. Davloom judges "the machine
itself" by the address the request names, so a proxy that serves plain HTTP to other machines
and passes requests on to `localhost` defeats the check: a proxy in front of Davloom must serve
HTTPS and send `X-Forwarded-Proto`.

## Behind a reverse proxy

Set `DAVLOOM_URL` to the address people open, such as `https://files.example.com`. Davloom takes
changes to its API only from pages on that address, and passkeys are bound to it. Without it,
Davloom takes changes from the address each request names in `Host`, and logs a warning when it
starts; a proxy that rewrites `Host` then makes every change of the Dashboard, registration
included, answer 403 `cross_site`. The proxy must pass the client's `Host` on, and say that the
client used HTTPS.

Sign-in is rate limited by the client's address. Behind a proxy every request comes from the
proxy, so all clients would share one limit, and anyone could keep the owner from signing in. Name
the proxies in `DAVLOOM_TRUSTED_PROXIES`, a list of addresses or CIDR ranges separated by commas
or spaces. Only when a request comes from one of them does Davloom read `X-Forwarded-For`, from the
right, and take the nearest address that is not a trusted proxy as the client's. Do not list a
proxy that passes on an `X-Forwarded-For` it did not write itself, and do not list a range that
clients can send from. Davloom refuses to start when an entry is not an address or a range.

Caddy passes `Host` on and sets `X-Forwarded-For` and `X-Forwarded-Proto` by itself:

```caddyfile
files.example.com {
	reverse_proxy davloom:3000
}
```

nginx sends its own upstream name as `Host` unless told otherwise:

```nginx
server {
    listen 443 ssl;
    server_name files.example.com;
    client_max_body_size 0;
    location / {
        proxy_pass http://davloom:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_request_buffering off;
    }
}
```

With either proxy on the Docker network, set:

```bash
DAVLOOM_URL=https://files.example.com
# The proxy's address as Davloom sees it, such as the Docker network's range.
DAVLOOM_TRUSTED_PROXIES=172.16.0.0/12
```

## Settings

| Variable                                                   | Meaning                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `DAVLOOM_SECRET`                                           | Required. At least 32 bytes. Signs sessions and encrypts S3 secret keys.              |
| `DAVLOOM_CHECK_LEAKED_PASSWORDS`                           | `off` skips the Have I Been Pwned check of new passwords (see below).                 |
| `DAVLOOM_URL`                                              | The public address. Passkeys need it; once set, the API takes changes only from it.   |
| `DAVLOOM_SETUP_TOKEN`                                      | Optional. Registration and import ask for it; without it the first visitor registers. |
| `DAVLOOM_TRUSTED_PROXIES`                                  | Addresses or CIDR ranges of reverse proxies whose `X-Forwarded-For` names the client. |
| `DAVLOOM_DATA_DIR`                                         | Where SQLite keeps `davloom.sqlite`; `/data` in the image, a volume.                  |
| `DAVLOOM_S3_ENDPOINT`                                      | The S3-compatible endpoint of the default backend, such as `http://rustfs:9000`.      |
| `DAVLOOM_S3_ACCESS_KEY_ID`, `DAVLOOM_S3_SECRET_ACCESS_KEY` | Its credentials.                                                                      |
| `DAVLOOM_S3_BUCKET`                                        | The bucket; `davloom` unless set.                                                     |
| `DAVLOOM_S3_REGION`                                        | `us-east-1` unless set.                                                               |
| `DAVLOOM_S3_PREFIX`                                        | A key prefix inside the bucket, ending at `/`; empty unless set.                      |
| `DAVLOOM_S3_FORCE_PATH_STYLE`                              | `false` for stores that want the bucket in the host name; true otherwise.             |
| `DAVLOOM_ALLOW_HTTP`                                       | `1` serves WebDAV and the API over plain HTTP to any address, for a trusted LAN.      |
| `HOST`, `PORT`                                             | Where the server listens; `0.0.0.0:3000` in the image.                                |

More S3-compatible backends can be added later through the API (`POST /api/backends` with `kind:
"s3"`); their secret keys are stored encrypted with `DAVLOOM_SECRET`.

Davloom refuses passwords shorter than 12 characters and passwords that appear in known breaches,
which it checks with the Have I Been Pwned range API (`api.pwnedpasswords.com`; only the first five
characters of the password's SHA-1 hash leave the server). When that API cannot be reached, Davloom
refuses the new password with `password_check_failed` (503) rather than accept it unchecked. On a
network without internet access, set `DAVLOOM_CHECK_LEAKED_PASSWORDS=off`.

## Without Docker

```bash
bun install --frozen-lockfile
bun run --filter @davloom/web build
DAVLOOM_SECRET=… DAVLOOM_S3_ENDPOINT=… bun apps/api/src/entry.bun.ts
```

## Smoke test

Once the account exists and a Read/Write API Key exists, check the stack end to end from a checkout
of this repository:

```bash
DAVLOOM_SMOKE_KEY=dav_… bun scripts/smoke.ts http://localhost:3000
```

`docs/deployment/cloudflare.md` lists what it checks.

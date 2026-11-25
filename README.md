# Davloom

Davloom is an open-source WebDAV storage server with a web Dashboard. It runs for free on
Cloudflare Workers, with no payment method, or self-hosted with Docker on Bun, SQLite and any
S3-compatible storage such as RustFS.

- **WebDAV Class 1 and 2**: every RFC 4918 method, LOCK and UNLOCK included, so macOS Finder, Windows
  Explorer, rclone and other clients mount it read-write. It passes every litmus suite.
- **API Keys for clients**: each key is Read Only or Read / Write, may expire, and may be limited
  to some Mounts or folders. The administrator's password never works over WebDAV.
- **Storage backends**: Cloudflare Durable Objects (the free default), Cloudflare R2, and
  S3-compatible storage. A Mount publishes a backend, or a folder in one, at `/dav/<mount>/`.
- **Proven decisions**: the rules that decide an outcome without I/O (namespace operations,
  conditional requests, byte ranges, permissions and key scopes, names) are written in Bend 2 and
  proven; the code that runs is compiled from the code that was proven.

## Install

- [Cloudflare Workers Free](docs/deployment/cloudflare.md): Workers, D1 and Durable Objects.
- [Docker](docs/deployment/docker.md): Bun, SQLite and RustFS or another S3-compatible store.
- [Security](docs/security.md): how each security requirement is met, and what tests hold it.
- [Moving an instance](docs/deployment/migration.md): export the records of one deployment and
  import them into another.

## Use

1. Open the Dashboard right after deploying and create your account. The first account becomes
   the owner, and registration closes for everyone once it exists.
2. On **Credentials**, create an API Key. Davloom shows the whole key once.
3. Mount `https://<your host>/dav/` in your client. The username can be anything; the password is
   the key. Finder also takes the bare address, `https://<your host>`: the root answers WebDAV's
   OPTIONS and PROPFIND with a redirect to `/dav/`, which Finder follows, while a browser opening
   it still gets the Dashboard. Other clients, rclone among them, need the `/dav/` address.

| Client       | How                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| macOS Finder | Go, Connect to Server (⌘K), `https://<host>` or `https://<host>/dav/`                                               |
| Windows      | Map network drive, `https://<host>/dav/`                                                                            |
| rclone       | `rclone config create davloom webdav url=https://<host>/dav vendor=other user=davloom pass=$(rclone obscure <key>)` |
| Linux        | davfs2 or a file manager's "Connect to server" with `davs://<host>/dav/`                                            |

## Develop

Everything runs on Bun. See [CLAUDE.md](CLAUDE.md) for the commands and rules, [docs/ci.md](docs/ci.md)
for the checks, and [docs/architecture/overview.md](docs/architecture/overview.md) for how the parts
fit together.

```bash
bun install --frozen-lockfile
bun run check
```

## License

[GNU Affero General Public License, version 3 only](LICENSE) (`AGPL-3.0-only`). If you change
Davloom and let other people use it over a network, you must offer them the source of your version.

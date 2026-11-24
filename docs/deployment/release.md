# Releases and rollback

A release is a Git tag `v<version>`, such as `v1.0.0`. Pushing the tag starts
`.github/workflows/release.yml`, which publishes the self-hosted Docker image and creates the
GitHub Release. The Cloudflare deployment does not wait for a tag: `.github/workflows/deploy.yml`
deploys every push to `main` (see [cloudflare.md](cloudflare.md)).

## Before tagging

- Every required check has passed on the commit, and `.github/workflows/mutation.yml` has passed on
  it (PRD §11: StrykerJS must pass before a release). Start it with `gh workflow run mutation.yml`.
- No law in `packages/laws/LAWS.bend` is unproven (PRD §4): the `laws` check runs the proofs.
- The macOS Finder acceptance and the Cloud Free quota check of PRD §11 are done.

Then tag the commit on `main` and push the tag:

```bash
git tag -a v1.0.0 -m "Davloom v1.0.0"
git push origin v1.0.0
```

A version with a pre-release part, such as `v1.0.0-rc.1`, becomes a GitHub pre-release and does
not move the image's `latest` tag.

## What the workflow does

| Job                              | What it does                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image (amd64)`, `image (arm64)` | Builds `deploy/docker/Dockerfile` with Docker Buildx on a runner of each architecture, starts the image with RustFS and runs `scripts/image-smoke.ts` against it: first-run setup, an API Key, then the checks of `scripts/smoke.ts`. The image leaves the job as a `docker save` archive.                                               |
| `scan (amd64)`, `scan (arm64)`   | In a job that holds no secret: Trivy fails on any High or Critical vulnerability that has a fix, and on any High or Critical misconfiguration of the Dockerfile and Compose file; Syft writes the SBOM in SPDX and Syft JSON; `scripts/license-check.ts` fails on an npm package whose license `scripts/lib/licenses.ts` does not allow. |
| `publish`                        | Tags only. Pushes the archives that were scanned to `ghcr.io/markchu-git/davloom` as `<version>-amd64` and `<version>-arm64`, joins them under `<version>` (and `latest`), and attests the provenance of the joined image and the SBOM of each platform's image with GitHub Artifact Attestations.                                       |
| `release`                        | Tags only. Creates the GitHub Release with generated notes, the image's digest and both SBOMs.                                                                                                                                                                                                                                           |

Trivy and Syft are the release binaries that `scripts/lib/tools.ts` pins by version and SHA-256,
run through `bun scripts/tool.ts`; no third-party action runs them. A pull request that changes the
image, its scripts or the workflow runs the `image` and `scan` jobs, and publishes nothing.

The same steps run locally:

```bash
docker buildx build --load -f deploy/docker/Dockerfile -t davloom:local .
deploy/docker/smoke.sh davloom:local
docker save davloom:local -o image.tar
bun scripts/tool.ts trivy image --input image.tar --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1
bun scripts/tool.ts trivy config --severity HIGH,CRITICAL --exit-code 1 deploy/docker
bun scripts/tool.ts syft scan docker-archive:image.tar -o syft-json=sbom.syft.json
bun scripts/license-check.ts sbom.syft.json
```

A license the check refuses is either a dependency to replace or a license to review: add it to
`ALLOWED` in `scripts/lib/licenses.ts`, with the reason in the pull request, only when it lets
Davloom ship the package. A vulnerability Trivy reports is fixed by updating the dependency or the
base image's digest, not by ignoring it.

## Checking a published image

```bash
gh attestation verify oci://ghcr.io/markchu-git/davloom:v1.0.0 --repo MarkChu-git/davloom
gh attestation verify oci://ghcr.io/markchu-git/davloom:v1.0.0 --repo MarkChu-git/davloom \
  --predicate-type https://spdx.dev/Document/v2.3
```

The first command shows which workflow run built the image from which commit; the second, the
SBOM attested for it.

## Rolling back

### Docker

Davloom's database migrations only go forward. A release whose migrations ran cannot read a
database that an older release then writes to, and an older release may fail on a newer schema. So
a rollback restores the data the older release last saw:

1. Stop Davloom: `docker compose -f deploy/docker/compose.yaml stop davloom`.
2. If the release being left applied a migration (its notes list changes under
   `packages/database/drizzle`), restore the `davloom-data` volume, which holds
   `davloom.sqlite`, from the backup taken before the upgrade. Without a backup, keep the newer
   release and fix forward instead: a newer release reads every older database
   (`tests/integration/compat/upgrade/` tests each older migration set).
3. Pin the previous image by its digest, which the previous release's notes give, in
   `compose.yaml`: replace the `build:` section of the `davloom` service with
   `image: ghcr.io/markchu-git/davloom@sha256:<digest>`.
4. Start it again: `docker compose -f deploy/docker/compose.yaml up -d davloom`, and run
   `DAVLOOM_SMOKE_KEY=<a Read/Write key> bun scripts/smoke.ts <its address>`.

Files in the S3-compatible store need no rollback: no release changes how they are stored.

Back up before every upgrade, with Davloom stopped and the volume name that `docker volume ls`
shows, such as `docker_davloom-data`:

```bash
docker run --rm -v <volume>:/data -v "$PWD":/backup busybox tar czf /backup/davloom-data.tgz -C /data .
```

### Cloudflare Workers

A Worker rolls back to an earlier version, and D1 Time Travel restores a database to any minute of
the last 7 days on the Workers Free plan (30 on a paid plan):

```bash
cd apps/api
bunx --bun wrangler deployments list          # the versions and when each was deployed
bunx --bun wrangler rollback <version-id>     # serve an earlier version again
# Only when the version being left applied a D1 migration:
bunx --bun wrangler d1 time-travel restore davloom --timestamp=<RFC 3339 time before the deploy>
```

`wrangler rollback` changes only the Worker's code; D1 and the Durable Objects keep their data.
Restore D1 with time travel when the newer version migrated it, to a time before that deploy, and
know that it also drops every record written since. Then revert the commits on `main`, because the
next push to `main` deploys again.

# Davloom self-hosted: Bun + SQLite, with an S3-compatible backend such as RustFS.
# Build from the repository root: docker build -f deploy/docker/Dockerfile -t davloom .
# The release workflow (.github/workflows/release.yml) builds this file for each tag, scans the
# image with Trivy and publishes it to GHCR.
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts \
  && bun run --filter @davloom/web build

# The dependencies the server needs at run time: those of @davloom/api and the workspaces it
# uses, without development dependencies or the optional peers Bun would add, so that no build or
# test tool, and none of their binaries such as esbuild and the TypeScript compiler, ships.
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS dependencies
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts --production --omit=peer --filter @davloom/api

FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d
# The commit About this instance shows: docker build --build-arg DAVLOOM_COMMIT=$(git rev-parse HEAD)
ARG DAVLOOM_COMMIT=""
ENV DAVLOOM_COMMIT=$DAVLOOM_COMMIT
# The security updates Debian has published since the base image was built.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=dependencies /app /app
COPY --from=build /app/apps/web/dist /app/apps/web/dist
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DAVLOOM_DATA_DIR=/data
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
EXPOSE 3000
USER bun
CMD ["bun", "apps/api/src/entry.bun.ts"]

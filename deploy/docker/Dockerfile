# Davloom self-hosted: Bun + SQLite, with an S3-compatible backend such as RustFS.
# Build from the repository root: docker build -f deploy/docker/Dockerfile -t davloom .
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts \
  && bun run --filter @davloom/web build

FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DAVLOOM_DATA_DIR=/data
VOLUME /data
EXPOSE 3000
USER bun
CMD ["bun", "apps/api/src/entry.bun.ts"]

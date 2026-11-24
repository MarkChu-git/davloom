#!/usr/bin/env bash
# Starts an image of Davloom with RustFS beside it, the way deploy/docker/compose.yaml runs them,
# and runs scripts/image-smoke.ts against it. The release workflow runs it on each image it built
# before anything is published; locally: deploy/docker/smoke.sh davloom:local
set -euo pipefail

image="${1:?usage: deploy/docker/smoke.sh <image>}"
rustfs="rustfs/rustfs:1.0.6@sha256:ee717072290bec9b11abfc0365f8310b00df1cd9b3639943edae47bdef05044a"
name="davloom-smoke-$$"
port="${DAVLOOM_SMOKE_PORT:-3900}"
s3_secret="$(openssl rand -hex 16)"

cleanup() {
  if [ "${status:-0}" != 0 ]; then docker logs "$name-davloom" 2>&1 | tail -50 || true; fi
  docker rm -f "$name-davloom" "$name-rustfs" > /dev/null 2>&1 || true
  docker network rm "$name" > /dev/null 2>&1 || true
}
trap 'status=$?; cleanup' EXIT

docker network create "$name" > /dev/null
docker run -d --name "$name-rustfs" --network "$name" --network-alias rustfs \
  -e RUSTFS_ACCESS_KEY=davloom -e RUSTFS_SECRET_KEY="$s3_secret" "$rustfs" > /dev/null
docker run -d --name "$name-davloom" --network "$name" -p "127.0.0.1:$port:3000" \
  -e DAVLOOM_SECRET="$(openssl rand -hex 32)" \
  -e DAVLOOM_CHECK_LEAKED_PASSWORDS=off \
  -e DAVLOOM_ALLOW_HTTP=1 \
  -e DAVLOOM_S3_ENDPOINT=http://rustfs:9000 \
  -e DAVLOOM_S3_ACCESS_KEY_ID=davloom \
  -e DAVLOOM_S3_SECRET_ACCESS_KEY="$s3_secret" \
  -e DAVLOOM_S3_BUCKET=davloom \
  "$image" > /dev/null
bun scripts/image-smoke.ts "http://127.0.0.1:$port"

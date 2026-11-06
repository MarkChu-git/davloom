// Reruns the HTTP compatibility tests with another Elysia version, then restores the checkout.
// Usage: bun scripts/rerun-with-elysia.ts <version>
import { resolve } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("Usage: bun scripts/rerun-with-elysia.ts <version>");
  process.exit(1);
}

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const MANIFESTS = ["apps/api/package.json", "tests/integration/compat/package.json"];
const WORKER_ENTRIES = [
  "apps/api/src/entry.workers.ts",
  "tests/integration/compat/probe/entry.workers.ts",
];
const ROUTE_FILES = [
  "apps/api/src/app.ts",
  "apps/api/src/entry.bun.ts",
  "tests/integration/compat/probe/identity-routes.ts",
  "tests/integration/compat/probe/store-routes.workers.ts",
];
const SAVED_FILES = [...MANIFESTS, ...WORKER_ENTRIES, ...ROUTE_FILES, "bun.lock"];

// The source changes Elysia 2.0 needs. They are applied for the run and undone afterwards.
// Elysia 2.0 takes a route's options before its handler, and has no Cloudflare adapter of its own.
const HANDLER_BEFORE_OPTIONS =
  /\.all\(\s*("[^"]+"),\s*(\(\{ request \}\) => [^\n]+?\)),\s*\{\s*parse: "none",?\s*\},?\s*\)/g;

const migrateToElysia2 = (source: string): string =>
  source
    .replace(HANDLER_BEFORE_OPTIONS, '.all($1, { parse: "none" }, $2)')
    .replace(
      'import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";',
      'import { WebStandardAdapter as CloudflareAdapter } from "elysia/adapter/web-standard";',
    );

const path = (file: string) => resolve(REPO_ROOT, file);
const run = (command: string[], cwd = REPO_ROOT) =>
  Bun.spawnSync(command, { cwd, stdout: "inherit", stderr: "inherit" }).exitCode;

const saved = new Map<string, string>();
for (const file of SAVED_FILES) {
  saved.set(file, await Bun.file(path(file)).text());
}

let exitCode = 1;
try {
  for (const file of MANIFESTS) {
    const manifest = JSON.parse(saved.get(file) ?? "{}");
    manifest.dependencies.elysia = version;
    await Bun.write(path(file), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (version.startsWith("2.")) {
    for (const file of [...ROUTE_FILES, ...WORKER_ENTRIES]) {
      await Bun.write(path(file), migrateToElysia2(saved.get(file) ?? ""));
    }
  }
  if (run(["bun", "install"]) === 0) {
    exitCode = run(["bun", "run", "test:http", "--silent=false"], path("tests/integration/compat"));
  }
} finally {
  for (const [file, content] of saved) {
    await Bun.write(path(file), content);
  }
  run(["bun", "install", "--frozen-lockfile"]);
}

console.log(`Elysia ${version}: ${exitCode === 0 ? "passed" : "failed"}`);
process.exit(exitCode);

// Mutation-tests packages/core and packages/webdav with StrykerJS, one run per package, each with
// a break threshold of 80 (PRD §11, Decision 14 of add-phase-1-core). `bun run test:mutation` runs
// both; `bun run test:mutation webdav` runs one. Every package runs even when one fails, and the
// failed ones are named at the end.
import { MUTATED_PACKAGES, type MutatedPackage } from "./mutation/stryker";

const isMutated = (name: string): name is MutatedPackage =>
  (MUTATED_PACKAGES as readonly string[]).includes(name);

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !isMutated(name));
if (unknown.length > 0) {
  console.error(
    `Unknown package: ${unknown.join(", ")}. Choose from ${MUTATED_PACKAGES.join(", ")}.`,
  );
  process.exit(2);
}
const packages = requested.length > 0 ? requested.filter(isMutated) : [...MUTATED_PACKAGES];

const failed: string[] = [];
for (const name of packages) {
  console.log(`\n=== mutation: packages/${name} ===`);
  const started = performance.now();
  // The preload works around two Bun bugs in Stryker's main process (see the file); the test
  // runner processes it forks need neither fix.
  const { exitCode } = Bun.spawnSync(
    [
      "bun",
      "--bun",
      "--preload",
      "./scripts/mutation/preload.ts",
      "node_modules/@stryker-mutator/core/bin/stryker.js",
      "run",
      `packages/${name}/stryker.config.ts`,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const minutes = ((performance.now() - started) / 60_000).toFixed(1);
  console.log(`packages/${name}: ${exitCode === 0 ? "passed" : "failed"} in ${minutes} min`);
  if (exitCode !== 0) {
    failed.push(`packages/${name}`);
  }
}

if (failed.length > 0) {
  console.error(`\nMutation testing failed for: ${failed.join(", ")}`);
  process.exit(1);
}

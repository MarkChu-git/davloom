// Runs every check, then names the ones that failed. Exits non-zero if any failed.
// `bun --bun run` makes tools whose launchers name Node run on Bun instead.
const STEPS: [name: string, command: string[]][] = [
  ["lint", ["bun", "--bun", "run", "lint"]],
  ["format", ["bun", "--bun", "run", "format:check"]],
  ["pinned dependencies", ["bun", "scripts/check-pinned-deps.ts"]],
  ["generated theme", ["bun", "--bun", "run", "--filter", "@davloom/ui", "check:theme"]],
  ["typecheck", ["bun", "--bun", "run", "typecheck"]],
  ["unit tests", ["bun", "--bun", "run", "test"]],
  ["build", ["bun", "--bun", "run", "build"]],
];

const failed: string[] = [];
for (const [name, command] of STEPS) {
  console.log(`\n=== ${name} ===`);
  const { exitCode } = Bun.spawnSync(command, { stdout: "inherit", stderr: "inherit" });
  if (exitCode !== 0) {
    failed.push(name);
  }
}

console.log();
if (failed.length > 0) {
  console.error(`Failed checks: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("All checks passed");

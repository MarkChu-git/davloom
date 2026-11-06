// Runs every check, then names the ones that failed. Exits non-zero if any failed.
const STEPS: [name: string, command: string[]][] = [
  ["lint", ["bun", "run", "lint"]],
  ["format", ["bun", "run", "format:check"]],
  ["pinned dependencies", ["bun", "scripts/check-pinned-deps.ts"]],
  ["generated theme", ["bun", "run", "--filter", "@davloom/ui", "check:theme"]],
  ["typecheck", ["bun", "run", "typecheck"]],
  ["unit tests", ["bun", "run", "test"]],
  ["build", ["bun", "run", "build"]],
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

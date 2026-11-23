// Compiles every Bend module in packages/laws/src to packages/laws/src/compiled/<module>.mjs with
// the pinned Bend: `bun run laws:build`. With --check it compiles to a temporary directory instead,
// fails when a committed .mjs differs from what Bend writes, and runs the proof checkers on
// packages/laws/PROOF.bend when it exists. `bun run laws:setup` installs the toolchain first.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readToolchain, toolchainPaths } from "./lib/laws-toolchain";
import { platformOf, toolCacheDir } from "./lib/tools";

const root = fileURLToPath(new URL("..", import.meta.url));
const lawsDir = join(root, "packages/laws");
const sourceDir = join(lawsDir, "src");
const compiledDir = join(sourceDir, "compiled");
const check = process.argv.includes("--check");

const paths = toolchainPaths(
  await readToolchain(root),
  toolCacheDir(process.env),
  platformOf(process.platform, process.arch),
);
if (!(await Bun.file(paths.bend).exists())) {
  console.error(`No Bend at ${paths.bend}. Run \`bun run laws:setup\` first.`);
  process.exit(1);
}

const env = { ...process.env, BEND_NO_TELEMETRY: "1", BENDTT: paths.kernel };
const run = (args: string[], cwd: string) => {
  const result = Bun.spawnSync([paths.bend, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, output: result.stdout.toString() + result.stderr.toString() };
};

const modules = (await readdir(sourceDir)).filter((name) => name.endsWith(".bend")).toSorted();
const outDir = check ? await mkdtemp(join(tmpdir(), "davloom-laws-")) : compiledDir;
const failures: string[] = [];

for (const file of modules) {
  const name = file.slice(0, -".bend".length);
  const target = join(outDir, `${name}.mjs`);
  const compiled = run([file, "-o", target], sourceDir);
  if (!compiled.ok) {
    failures.push(`${file} does not compile:\n${compiled.output}`);
    continue;
  }
  const text = await Bun.file(target).text();
  if (/^\s*import\s/m.test(text)) {
    failures.push(`${file} compiles to a module that imports foreign code`);
  }
  if (check) {
    const committed = Bun.file(join(compiledDir, `${name}.mjs`));
    if (!(await committed.exists()) || (await committed.text()) !== text) {
      failures.push(
        `src/compiled/${name}.mjs differs from what Bend compiles; run bun run laws:build`,
      );
    }
  }
  console.log(`${check ? "checked" : "compiled"} ${file}`);
}

if (check) {
  await rm(outDir, { recursive: true, force: true });
  if (await Bun.file(join(lawsDir, "PROOF.bend")).exists()) {
    for (const args of [["PROOF.bend"], ["PROOF.bend", "--verdict"]]) {
      const proof = run(args, lawsDir);
      if (!proof.ok || !proof.output.includes("ALL PROOFS CHECK")) {
        failures.push(`bend ${args.join(" ")} did not print ALL PROOFS CHECK:\n${proof.output}`);
      } else {
        console.log(`bend ${args.join(" ")}: ALL PROOFS CHECK`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

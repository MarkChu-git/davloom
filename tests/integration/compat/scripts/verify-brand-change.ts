// Changes the brand color, rebuilds, and checks that the design system and our own component both
// follow it. Then it restores the checkout and confirms that no dependency was touched.
import { Glob } from "bun";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const NEW_ACCENT = "#7a3ea1";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const COMPAT_DIRECTORY = resolve(REPO_ROOT, "tests/integration/compat");
const BRAND_FILE = resolve(REPO_ROOT, "packages/ui/src/tokens/brand.ts");
const LOCKFILE = resolve(REPO_ROOT, "bun.lock");
const ROOT_MANIFEST = resolve(REPO_ROOT, "package.json");
const DEPENDENCY_STORE = resolve(REPO_ROOT, "node_modules/.bun");
const DEPENDENCY_GLOB = "{@astryxdesign+,@stylexjs+}*/node_modules/{@astryxdesign,@stylexjs}/**";

const run = (command: string[], cwd = REPO_ROOT, env: Record<string, string> = {}) =>
  Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  }).exitCode;

const rebuild = () => run(["bun", "run", "--filter", "@davloom/web", "build"]);

const hashOf = (content: string | Uint8Array) => Bun.hash(content).toString(16);

/** One hash per dependency file, so a changed file can be named instead of only detected. */
const fingerprintDependencies = async (): Promise<Map<string, string>> => {
  const fingerprint = new Map<string, string>();
  const glob = new Glob(DEPENDENCY_GLOB);
  for await (const file of glob.scan({ cwd: DEPENDENCY_STORE, followSymlinks: false })) {
    const bytes = await Bun.file(resolve(DEPENDENCY_STORE, file)).bytes();
    fingerprint.set(file, hashOf(bytes));
  }
  return fingerprint;
};

const changedFiles = (before: Map<string, string>, after: Map<string, string>): string[] =>
  [...new Set([...before.keys(), ...after.keys()])].filter(
    (file) => before.get(file) !== after.get(file),
  );

const savedBrand = await Bun.file(BRAND_FILE).text();
const savedLockfile = await Bun.file(LOCKFILE).text();
const dependenciesBefore = await fingerprintDependencies();
if (dependenciesBefore.size === 0) {
  throw new Error(`No Astryx or StyleX files found under ${DEPENDENCY_STORE}`);
}

const currentAccent = /accent: \["(#[0-9a-f]{6})"/.exec(savedBrand)?.[1];
if (!currentAccent || currentAccent === NEW_ACCENT) {
  throw new Error(`Cannot change the accent color from ${currentAccent} to ${NEW_ACCENT}`);
}

let exitCode = 1;
try {
  await Bun.write(
    BRAND_FILE,
    savedBrand.replace(`accent: ["${currentAccent}"`, `accent: ["${NEW_ACCENT}"`),
  );
  if (rebuild() === 0) {
    exitCode = run(["bunx", "playwright", "test", "ui/styles.spec.ts"], COMPAT_DIRECTORY, {
      DAVLOOM_EXPECTED_BRAND_LIGHT: NEW_ACCENT,
    });
  }
} finally {
  await Bun.write(BRAND_FILE, savedBrand);
  if (rebuild() !== 0) {
    exitCode = 1;
  }
}

const problems: string[] = [];
if (exitCode !== 0) {
  problems.push(`the rendered brand color did not become ${NEW_ACCENT}`);
}
if (existsSync(resolve(REPO_ROOT, "patches"))) {
  problems.push("a patches directory exists");
}
if ("patchedDependencies" in (await Bun.file(ROOT_MANIFEST).json())) {
  problems.push("package.json declares patchedDependencies");
}
if ((await Bun.file(LOCKFILE).text()) !== savedLockfile) {
  problems.push("bun.lock changed");
}
const changed = changedFiles(dependenciesBefore, await fingerprintDependencies());
if (changed.length > 0) {
  problems.push(`dependency files changed: ${changed.join(", ")}`);
}

if (problems.length > 0) {
  console.error(`Brand change check failed: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(
  `Brand change check passed: both components followed ${NEW_ACCENT}, ` +
    `and ${dependenciesBefore.size} Astryx and StyleX files are unchanged.`,
);

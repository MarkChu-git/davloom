// Fails when the design system or its style compiler is declared with anything but an exact
// version, or when an installed StyleX package is outside the range Astryx declares for it.
import { dirname, join } from "node:path";
import { Glob } from "bun";
import {
  findDesignDependencies,
  findPinViolations,
  findStyleXRangeViolations,
  type InstalledPackage,
  type Manifest,
} from "./lib/pinned-deps";

const readManifest = (path: string): Promise<Manifest & { workspaces?: string[] }> =>
  Bun.file(path).json();

// Looks a package up through node_modules the way Bun resolves it from `dir`, without leaving the repository.
const readInstalled = async (name: string, dir: string): Promise<InstalledPackage | undefined> => {
  for (let current = dir; ; current = dirname(current)) {
    const file = Bun.file(join(current, "node_modules", name, "package.json"));
    if (await file.exists()) {
      return file.json();
    }
    if (current === ".") {
      return undefined;
    }
  }
};

const root = await readManifest("package.json");
const manifests: Record<string, Manifest> = { "package.json": root };
for (const pattern of root.workspaces ?? []) {
  for await (const path of new Glob(`${pattern}/package.json`).scan(".")) {
    manifests[path] = await readManifest(path);
  }
}

const violations = findPinViolations(manifests);
const installed = new Map<string, InstalledPackage>();
for (const [path, manifest] of Object.entries(manifests)) {
  for (const name of findDesignDependencies(manifest)) {
    const found = await readInstalled(name, dirname(path));
    if (found === undefined) {
      violations.push(`${path}: ${name} is not installed; run bun install`);
    } else {
      installed.set(`${found.name}@${found.version}`, found);
    }
  }
}
violations.push(...findStyleXRangeViolations([...installed.values()]));

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(
  `Pinned dependencies OK (${Object.keys(manifests).length} manifests and ${installed.size} installed packages checked)`,
);

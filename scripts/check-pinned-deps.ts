// Fails when the design system or its style compiler is declared with anything but an exact version.
import { Glob } from "bun";
import { findPinViolations, type Manifest } from "./lib/pinned-deps";

const readManifest = (path: string): Promise<Manifest & { workspaces?: string[] }> =>
  Bun.file(path).json();

const root = await readManifest("package.json");
const manifests: Record<string, Manifest> = { "package.json": root };
for (const pattern of root.workspaces ?? []) {
  for await (const path of new Glob(`${pattern}/package.json`).scan(".")) {
    manifests[path] = await readManifest(path);
  }
}

const violations = findPinViolations(manifests);
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`Pinned dependencies OK (${Object.keys(manifests).length} manifests checked)`);

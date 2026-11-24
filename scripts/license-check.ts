import { licenseFindings, type SbomPackage } from "./lib/licenses";

// `bun scripts/license-check.ts <sbom.syft.json>...`: fails when an npm package installed in the
// image is under a license that scripts/lib/licenses.ts does not allow. The release workflow runs
// it on the Syft SBOM of each image it builds.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** The packages of a Syft JSON document, with the fields the check reads. */
const packagesOf = (document: unknown, file: string): SbomPackage[] => {
  const artifacts = isRecord(document) ? document["artifacts"] : undefined;
  if (!Array.isArray(artifacts)) throw new Error(`${file} is not a Syft JSON SBOM`);
  return artifacts.filter(isRecord).map((artifact) => ({
    name: text(artifact["name"]) ?? "",
    version: text(artifact["version"]) ?? "",
    type: text(artifact["type"]) ?? "",
    licenses: (Array.isArray(artifact["licenses"]) ? artifact["licenses"] : [])
      .filter(isRecord)
      .map((license) => ({
        value: text(license["value"]),
        spdxExpression: text(license["spdxExpression"]),
      })),
    locations: (Array.isArray(artifact["locations"]) ? artifact["locations"] : [])
      .filter(isRecord)
      .map((location) => ({ path: text(location["path"]) ?? "" })),
  }));
};

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: bun scripts/license-check.ts <sbom.syft.json>...");
  process.exit(2);
}
let failed = false;
for (const file of files) {
  const packages = packagesOf(await Bun.file(file).json(), file);
  const findings = licenseFindings(packages);
  const checked = packages.filter((pkg) => pkg.type === "npm").length;
  if (findings.length > 0) {
    failed = true;
    console.error(`${file}: ${findings.length} package(s) fail the license check:`);
    for (const finding of findings) console.error(`  ${finding}`);
  } else {
    console.log(`${file}: every installed npm package of ${checked} has an allowed license`);
  }
}
process.exit(failed ? 1 : 0);

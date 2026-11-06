const PINNED_SCOPES = ["@astryxdesign/", "@stylexjs/"];
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export type Manifest = Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>>;

/** Lists every design-system or style-compiler dependency that is not declared with an exact version. */
export const findPinViolations = (manifests: Record<string, Manifest>): string[] =>
  Object.entries(manifests).flatMap(([path, manifest]) =>
    DEPENDENCY_FIELDS.flatMap((field) =>
      Object.entries(manifest[field] ?? {})
        .filter(
          ([name, version]) =>
            PINNED_SCOPES.some((scope) => name.startsWith(scope)) && !EXACT_VERSION.test(version),
        )
        .map(
          ([name, version]) =>
            `${path}: ${field}.${name} is "${version}", expected an exact version`,
        ),
    ),
  );

const ASTRYX_SCOPE = "@astryxdesign/";
const STYLEX_SCOPE = "@stylexjs/";
const STYLEX = "@stylexjs/stylex";
const PINNED_SCOPES = [ASTRYX_SCOPE, STYLEX_SCOPE];
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export type Manifest = Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>>;

const isDesignPackage = (name: string): boolean =>
  PINNED_SCOPES.some((scope) => name.startsWith(scope));

/** Lists the design-system and style-compiler packages that a manifest declares in any field. */
export const findDesignDependencies = (manifest: Manifest): string[] => [
  ...new Set(
    DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})).filter(
      isDesignPackage,
    ),
  ),
];

/** Lists every design-system or style-compiler dependency that is not declared with an exact version. */
export const findPinViolations = (manifests: Record<string, Manifest>): string[] =>
  Object.entries(manifests).flatMap(([path, manifest]) =>
    DEPENDENCY_FIELDS.flatMap((field) =>
      Object.entries(manifest[field] ?? {})
        .filter(([name, version]) => isDesignPackage(name) && !EXACT_VERSION.test(version))
        .map(
          ([name, version]) =>
            `${path}: ${field}.${name} is "${version}", expected an exact version`,
        ),
    ),
  );

/** A package as its installed `package.json` describes it. */
export type InstalledPackage = {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
};

/**
 * Lists every installed StyleX package whose version is outside the range that an installed
 * Astryx package declares as a peer dependency. StyleX releases all its packages under one
 * version, so a StyleX package that Astryx does not name is held to its range for `@stylexjs/stylex`.
 */
export const findStyleXRangeViolations = (installed: InstalledPackage[]): string[] => {
  const styles = installed.filter(({ name }) => name.startsWith(STYLEX_SCOPE));
  return installed
    .filter(({ name }) => name.startsWith(ASTRYX_SCOPE))
    .flatMap((design) =>
      styles.flatMap((style) => {
        const peer = design.peerDependencies?.[style.name] === undefined ? STYLEX : style.name;
        const range = design.peerDependencies?.[peer];
        return range === undefined || Bun.semver.satisfies(style.version, range)
          ? []
          : [
              `${style.name} is ${style.version}, outside the range ${range} that ${design.name} ${design.version} declares for ${peer}`,
            ];
      }),
    );
};

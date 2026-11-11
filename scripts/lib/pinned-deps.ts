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
// One comparator of an npm version range, such as ^0.19.0, >=1.2, 1.x or *.
const COMPARATOR =
  /^(?:[~^]|[<>]=?|=)?v?(?:\*|x|X|\d+)(?:\.(?:\*|x|X|\d+)){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export type Manifest = Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>>;

const isDesignPackage = (name: string): boolean =>
  PINNED_SCOPES.some((scope) => name.startsWith(scope));

// Bun.semver.satisfies accepts strings it cannot parse, such as "latest" or "workspace:^1.0.0",
// so a range counts as readable only when every comparator in it uses npm range syntax.
const isReadableRange = (range: string): boolean =>
  range.split("||").every((set) => {
    const comparators = set
      .trim()
      .split(/\s+/)
      .filter((part) => part !== "-");
    return comparators.length > 0 && comparators.every((part) => COMPARATOR.test(part));
  });

/** Gives the version a manifest declares for each design-system or style-compiler package, from the first field that names it. */
export const findDesignDependencies = (manifest: Manifest): Record<string, string> => {
  const declared: Record<string, string> = {};
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (isDesignPackage(name) && !(name in declared)) {
        declared[name] = version;
      }
    }
  }
  return declared;
};

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

/** A design package as a manifest declares it, and as it is installed for that manifest's workspace. */
export type DesignInstall = {
  path: string;
  name: string;
  declared: string;
  installed: InstalledPackage | undefined;
};

/** Lists every declared design package that is not installed, or is installed at another version than declared. */
export const findInstallViolations = (installs: DesignInstall[]): string[] =>
  installs.flatMap(({ path, name, declared, installed }) => {
    if (installed === undefined) {
      return [`${path}: ${name} is not installed; run bun install`];
    }
    // A declared range is for the pin check to report.
    return EXACT_VERSION.test(declared) && installed.version !== declared
      ? [
          `${path}: ${name} is declared as ${declared} but ${installed.version} is installed; run bun install`,
        ]
      : [];
  });

/**
 * Lists every installed StyleX package whose version is outside the range that an installed
 * Astryx package declares as a peer dependency, and every such range the check cannot read.
 * StyleX releases all its packages under one version, so a StyleX package that Astryx does not
 * name is held to its range for `@stylexjs/stylex`.
 */
export const findStyleXRangeViolations = (installed: InstalledPackage[]): string[] => {
  const styles = installed.filter(({ name }) => name.startsWith(STYLEX_SCOPE));
  const violations = installed
    .filter(({ name }) => name.startsWith(ASTRYX_SCOPE))
    .flatMap((design) =>
      styles.flatMap((style) => {
        const peer = design.peerDependencies?.[style.name] === undefined ? STYLEX : style.name;
        const range = design.peerDependencies?.[peer];
        if (range === undefined) {
          return [];
        }
        if (!isReadableRange(range)) {
          return [
            `${design.name} ${design.version} declares ${JSON.stringify(range)} for ${peer}, which is not a version range this check can read`,
          ];
        }
        return Bun.semver.satisfies(style.version, range)
          ? []
          : [
              `${style.name} is ${style.version}, outside the range ${range} that ${design.name} ${design.version} declares for ${peer}`,
            ];
      }),
    );
  // An unreadable range is reported once, not once for every StyleX package held to it.
  return [...new Set(violations)];
};

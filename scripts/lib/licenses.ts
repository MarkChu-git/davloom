// The license check of the release image (PRD §11, "Syft SBOM + license check"). It reads the
// SBOM that Syft writes in its own JSON format and passes when every npm package installed in the
// image carries a license on ALLOWED, alone or in an SPDX expression that ALLOWED satisfies. A
// license outside the list fails the release until someone reviews it and adds it here. The base
// image's Debian packages and the Go modules inside prebuilt binaries are outside the check: they
// are the operating system and tools, not code Davloom links.

/**
 * Licenses that let Davloom ship a package in its image: the permissive ones, public domain
 * dedications, and the weak copyleft of LGPL and MPL, which covers only the package's own files.
 */
export const ALLOWED: ReadonlySet<string> = new Set([
  "0BSD",
  "Apache-2.0",
  "Artistic-2.0",
  "BlueOak-1.0.0",
  // Old packages name the BSD license without its clauses; each variant is allowed.
  "BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
]);

export interface SbomLicense {
  readonly value?: string;
  readonly spdxExpression?: string;
}

export interface SbomPackage {
  readonly name: string;
  readonly version: string;
  readonly type: string;
  readonly licenses?: readonly SbomLicense[];
  readonly locations?: readonly { readonly path: string }[];
}

/** An npm package name: a scope and a name, or a name alone, with no other slash. */
const PACKAGE_NAME = /^(@[^/@\s]+\/)?[^/@\s][^/\s]*$/;

/**
 * Whether a package is a dependency installed in the image: an npm package whose manifest is
 * `node_modules/<its name>/package.json`. Davloom's own workspaces live outside node_modules, and
 * a manifest deeper inside a package, such as rxjs/ajax or a package's bundled example app, is
 * part of the package around it, whose license covers it.
 */
export const isInstalledDependency = (pkg: SbomPackage): boolean =>
  pkg.type === "npm" &&
  PACKAGE_NAME.test(pkg.name) &&
  (pkg.locations ?? []).some(({ path }) => path.endsWith(`/node_modules/${pkg.name}/package.json`));

type Expression =
  | { readonly kind: "license"; readonly id: string }
  | { readonly kind: "and" | "or"; readonly left: Expression; readonly right: Expression };

const tokenize = (text: string): string[] =>
  text
    .replaceAll("(", " ( ")
    .replaceAll(")", " ) ")
    .split(/\s+/)
    .filter((token) => token !== "");

/**
 * Parses an SPDX license expression: identifiers joined by AND and OR, AND binding tighter, with
 * parentheses, and `<id> WITH <exception>` kept as one identifier. Returns null for text that is
 * not such an expression.
 */
export const parseExpression = (text: string): Expression | null => {
  const tokens = tokenize(text);
  let position = 0;
  const peek = () => tokens[position];
  const primary = (): Expression | null => {
    const token = peek();
    if (token === undefined || token === ")" || /^(AND|OR|WITH)$/i.test(token)) return null;
    position += 1;
    if (token === "(") {
      const inner = or();
      if (inner === null || peek() !== ")") return null;
      position += 1;
      return inner;
    }
    if (peek()?.toUpperCase() === "WITH") {
      const exception = tokens[position + 1];
      if (exception === undefined || /^[()]$|^(AND|OR|WITH)$/i.test(exception)) return null;
      position += 2;
      return { kind: "license", id: `${token} WITH ${exception}` };
    }
    return { kind: "license", id: token };
  };
  const binary =
    (kind: "and" | "or", operand: () => Expression | null) => (): Expression | null => {
      let left = operand();
      while (left !== null && peek()?.toLowerCase() === kind) {
        position += 1;
        const right = operand();
        if (right === null) return null;
        left = { kind, left, right };
      }
      return left;
    };
  const and = binary("and", primary);
  const or = binary("or", and);
  const expression = or();
  return expression !== null && position === tokens.length ? expression : null;
};

/** Whether an expression lets Davloom use the package: OR needs one side, AND both. */
export const isSatisfied = (expression: Expression, allowed: ReadonlySet<string>): boolean => {
  if (expression.kind === "license") return allowed.has(expression.id);
  const left = isSatisfied(expression.left, allowed);
  const right = isSatisfied(expression.right, allowed);
  return expression.kind === "and" ? left && right : left || right;
};

/** Why a package fails the check, or null when it passes. */
export const licenseProblem = (
  pkg: SbomPackage,
  allowed: ReadonlySet<string> = ALLOWED,
): string | null => {
  const declared = (pkg.licenses ?? [])
    .map((license) => (license.spdxExpression || license.value || "").trim())
    .filter((text) => text !== "");
  if (declared.length === 0) return "declares no license";
  // Several declarations are each a license the package is under, as with a legacy `licenses`
  // array, so every one must be allowed.
  for (const text of declared) {
    const expression = parseExpression(text);
    if (expression === null) return `declares "${text}", which is not an SPDX expression`;
    if (!isSatisfied(expression, allowed)) return `is under ${text}, which is not allowed`;
  }
  return null;
};

/** Each installed npm package of an SBOM that fails the check, as "name@version: reason". */
export const licenseFindings = (
  packages: readonly SbomPackage[],
  allowed: ReadonlySet<string> = ALLOWED,
): string[] => {
  const findings = new Set<string>();
  for (const pkg of packages.filter(isInstalledDependency)) {
    const problem = licenseProblem(pkg, allowed);
    if (problem !== null) findings.add(`${pkg.name}@${pkg.version} ${problem}`);
  }
  return [...findings].toSorted();
};

// The Stryker options that every mutated package shares (Decision 14 of add-phase-1-core). Each
// package's stryker.config.ts calls this with its own name; scripts/mutation.ts runs them.
export const MUTATED_PACKAGES = ["core", "webdav"] as const;
export type MutatedPackage = (typeof MUTATED_PACKAGES)[number];

export const strykerConfig = (name: MutatedPackage) => {
  const dir = `packages/${name}`;
  return {
    // Stryker runs from the repository root, so the sandbox keeps the repository's layout and the
    // package's imports of other workspace packages and the root tsconfig.json still resolve.
    mutate: [`${dir}/src/**/*.ts`, `!${dir}/src/**/*.test.ts`, `!${dir}/src/test{,ing}/**`],
    // Only what the package's tests load: the package, the workspace packages it imports, and the
    // root configuration files.
    ignorePatterns: ["/apps", "/deploy", "/docs", "/openspec", "/tests", "/scripts", "/coverage"],
    testRunner: "vitest",
    // Bun's isolated install keeps @stryker-mutator/core under node_modules/.bun, where Stryker
    // does not find the runner beside it, so the runner is named by its path.
    plugins: ["./node_modules/@stryker-mutator/vitest-runner/dist/src/index.js"],
    vitest: { configFile: `${dir}/vitest.config.ts`, related: true },
    // Stryker rewrites tsconfig.json with ts.parseConfigFileTextToJson, which TypeScript 7 no
    // longer exports. Naming a file that does not exist skips the rewrite.
    tsconfigFile: "stryker-skips-the-tsconfig-rewrite.json",
    coverageAnalysis: "perTest",
    thresholds: { high: 90, low: 80, break: 80 },
    reporters: ["clear-text", "progress", "html", "json"],
    htmlReporter: { fileName: `reports/mutation/${name}/index.html` },
    jsonReporter: { fileName: `reports/mutation/${name}/mutation.json` },
    tempDirName: `.stryker-tmp/${name}`,
    cleanTempDir: "always",
  };
};

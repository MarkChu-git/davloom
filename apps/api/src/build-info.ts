import pkg from "../package.json" with { type: "json" };

// The version and commit of this build. A build names its commit with a define, as the deploy
// workflow does (`wrangler deploy --define DAVLOOM_BUILD_COMMIT:'"<sha>"'`); a run from source, such
// as the Docker image, reads DAVLOOM_COMMIT instead.

declare const DAVLOOM_BUILD_COMMIT: string | undefined;

const definedCommit = (): string | null =>
  typeof DAVLOOM_BUILD_COMMIT === "string" && DAVLOOM_BUILD_COMMIT !== ""
    ? DAVLOOM_BUILD_COMMIT
    : null;

const envCommit = (): string | null => {
  const value = typeof process === "undefined" ? undefined : process.env.DAVLOOM_COMMIT;
  return value === undefined || value.trim() === "" ? null : value.trim();
};

export const buildInfo = (): { version: string; commit: string | null } => ({
  version: pkg.version,
  commit: definedCommit() ?? envCommit(),
});

// Runs the Playwright specs in the image the CI `ui` job runs them in, with the arguments it is
// given, so that the screenshot baselines are taken where CI compares them: another machine's
// fonts and rendering differ. It needs Docker, and works the same on Linux and macOS.
//
// The image is the one .github/workflows/ci.yml names, with the Bun binary of the pinned Bun image
// (scripts/lib/tools.ts) added. The repository's files go into the container by tar, without the
// host's node_modules, whose binaries may be another platform's; the container installs bun.lock
// with --ignore-scripts, as CI does, so the image's Node never runs, and builds the Dashboard.
// The screenshot baselines and test-results/ are mounted from the host, so --update-snapshots
// writes the new baselines into the repository and a failed comparison leaves its images there.
// Usage, from the repository root:
//   bun tests/integration/compat/scripts/playwright-docker.ts --project=screenshots-desktop
//   bun tests/integration/compat/scripts/playwright-docker.ts --update-snapshots --project=...
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { IMAGES, imageReference } from "../../../../scripts/lib/tools";

const ROOT = resolve(import.meta.dirname, "../../../..");
const COMPAT = "tests/integration/compat";
const SCREENSHOTS = `${COMPAT}/ui/__screenshots__`;
const RESULTS = `${COMPAT}/test-results`;

/** The Playwright image of the CI `ui` job, by its tag and digest. */
export const ciPlaywrightImage = (workflow: string): string => {
  const image = /^\s*image:\s*(mcr\.microsoft\.com\/playwright:\S+@sha256:[0-9a-f]{64})\s*$/m.exec(
    workflow,
  )?.[1];
  if (image === undefined) throw new Error("ci.yml names no pinned Playwright image");
  return image;
};

const run = (command: string[], stdin?: string | Blob): number => {
  const result = Bun.spawnSync(command, {
    cwd: ROOT,
    stdin: stdin === undefined ? "inherit" : new Blob([stdin]),
    stdout: "inherit",
    stderr: "inherit",
  });
  return result.exitCode;
};

const main = async () => {
  const bun = IMAGES.bun;
  if (bun === undefined) throw new Error("scripts/lib/tools.ts pins no Bun image");
  const playwright = ciPlaywrightImage(
    await Bun.file(resolve(ROOT, ".github/workflows/ci.yml")).text(),
  );
  const dockerfile = [
    `FROM ${imageReference(bun)} AS bun`,
    `FROM ${playwright}`,
    "COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun",
    "RUN ln -sf bun /usr/local/bin/bunx",
  ].join("\n");
  const tag = `davloom-playwright:${createHash("sha256").update(dockerfile).digest("hex").slice(0, 16)}`;
  const known = Bun.spawnSync(["docker", "image", "inspect", tag], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if (known.exitCode !== 0 && run(["docker", "build", "--tag", tag, "-"], dockerfile) !== 0) {
    throw new Error("docker build failed");
  }

  // The files Git tracks, and new ones it does not ignore, that are on disk.
  const listed = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate"],
    { cwd: ROOT },
  );
  if (listed.exitCode !== 0) throw new Error("git ls-files failed");
  const files = listed.stdout
    .toString()
    .split("\0")
    .filter((file) => file !== "" && existsSync(resolve(ROOT, file)));
  const archive = Bun.spawnSync(["tar", "-cf", "-", "--null", "-T", "-"], {
    cwd: ROOT,
    stdin: new Blob([files.join("\0")]),
  });
  if (archive.exitCode !== 0) throw new Error(archive.stderr.toString());

  mkdirSync(resolve(ROOT, SCREENSHOTS), { recursive: true });
  mkdirSync(resolve(ROOT, RESULTS), { recursive: true });
  const owner =
    process.getuid === undefined ? "" : `${process.getuid()}:${process.getgid?.() ?? 0}`;
  const quoted = process.argv.slice(2).map((argument) => `'${argument.replaceAll("'", "'\\''")}'`);
  const script = [
    "set -e",
    "mkdir -p /work",
    "tar -xf - -C /work",
    "cd /work",
    "bun install --frozen-lockfile --ignore-scripts",
    "bun run --filter @davloom/compat-tests build:web",
    `cd ${COMPAT}`,
    "status=0",
    `bunx --bun playwright test ${quoted.join(" ")} || status=$?`,
    // Files the container writes into the mounted folders belong to the host's user.
    ...(owner === "" ? [] : [`chown -R ${owner} ui/__screenshots__ test-results`]),
    'exit "$status"',
  ].join("\n");
  // A network that inspects TLS with a certificate of its own, as some proxies do, gives Bun the
  // same extra certificates in the container as on the host.
  const extraCerts = process.env.NODE_EXTRA_CA_CERTS;
  const certs =
    extraCerts !== undefined && existsSync(extraCerts)
      ? [
          "--volume",
          `${extraCerts}:/etc/davloom-extra-ca.crt:ro`,
          "--env",
          "NODE_EXTRA_CA_CERTS=/etc/davloom-extra-ca.crt",
        ]
      : [];
  const status = run(
    [
      "docker",
      "run",
      "--rm",
      "-i",
      "--ipc=host",
      "--env",
      "HOME=/root",
      "--env",
      `DAVLOOM_UI_PORT_BASE=${process.env.DAVLOOM_UI_PORT_BASE ?? ""}`,
      ...certs,
      // Bun's install cache outlives the container, so a second run downloads nothing.
      "--volume",
      "davloom-bun-install-cache:/root/.bun/install/cache",
      "--volume",
      `${resolve(ROOT, SCREENSHOTS)}:/work/${SCREENSHOTS}`,
      "--volume",
      `${resolve(ROOT, RESULTS)}:/work/${RESULTS}`,
      tag,
      "bash",
      "-c",
      script,
    ],
    new Blob([new Uint8Array(archive.stdout)]),
  );
  process.exit(status);
};

if (import.meta.main) await main();

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startWorkerdServer } from "./servers";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SERVE_WORKERS = resolve(import.meta.dirname, "../scripts/serve-workers.ts");
// The harness bundles into a `davloom-worker-*` directory under os.tmpdir().
const BUNDLE_PREFIX = "davloom-worker-";
// A custom build that records its process ID and then runs until something stops it.
const HANGING_BUILD = "echo $$ > build.pid && exec sleep 600";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "davloom-harness-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A new, empty directory for os.tmpdir(), so that a test sees only its own bundles. */
const emptyTmpdir = (): string => mkdtempSync(join(root, "tmp-"));

/** Points os.tmpdir() in this process at a new, empty directory. */
const useEmptyTmpdir = (): string => {
  const directory = emptyTmpdir();
  vi.stubEnv("TMPDIR", directory);
  return directory;
};

const bundlesIn = (directory: string) =>
  readdirSync(directory).filter((name) => name.startsWith(BUNDLE_PREFIX));

interface WorkerFixture {
  /** A custom build command, which runs in the Worker's directory. */
  readonly build?: string;
  /** The vars in its Wrangler config. */
  readonly vars?: Readonly<Record<string, string>>;
  /** More files for its directory, by name. */
  readonly files?: Readonly<Record<string, string>>;
}

/** Writes a Worker that answers with its vars, and returns the path of its Wrangler config. */
const writeWorker = (name: string, { build, vars, files = {} }: WorkerFixture = {}): string => {
  const directory = join(root, name);
  mkdirSync(directory);
  writeFileSync(
    join(directory, "worker.js"),
    "export default { fetch: (_request, env) => Response.json(env) };\n",
  );
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(directory, file), content);
  }
  const config = {
    name,
    main: "worker.js",
    compatibility_date: "2026-11-04",
    ...(vars === undefined ? {} : { vars }),
    // Without `cwd`, Wrangler runs the build in its own working directory.
    ...(build === undefined ? {} : { build: { command: build, cwd: directory } }),
  };
  const configPath = join(directory, "wrangler.jsonc");
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
};

/** Returns the process ID that HANGING_BUILD records, and throws until it has recorded one. */
const readBuildPid = (configPath: string): number => {
  const pid = Number(readFileSync(join(dirname(configPath), "build.pid"), "utf8"));
  if (!pid) {
    throw new Error("The custom build has not started yet");
  }
  return pid;
};

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("startWorkerdServer", () => {
  it("stops a bundle step that hangs, fails and removes the bundle", async () => {
    const tmp = useEmptyTmpdir();
    const config = writeWorker("hanging-build", { build: HANGING_BUILD });

    const starting = startWorkerdServer(config, { bundleTimeoutMs: 1000 });
    expect(bundlesIn(tmp)).toHaveLength(1);

    await expect(starting).rejects.toThrow(
      `Bundling ${config} did not finish in 1 s, so it was stopped.`,
    );
    expect(bundlesIn(tmp)).toEqual([]);
  });
});

// Wrangler reads `.env` only when there is no `.dev.vars`.
describe.each([".dev.vars", ".env"])(
  "startWorkerdServer with a %s file beside the config",
  (file) => {
    it("puts the vars it is given over the file, and the file over the config", async () => {
      const config = writeWorker(`vars${file.replaceAll(".", "-")}`, {
        vars: { FROM_CONFIG: "config", FROM_FILE: "config", FROM_TEST: "config" },
        files: { [file]: "FROM_FILE=file\nFROM_TEST=file\n" },
      });

      const server = await startWorkerdServer(config, { vars: { FROM_TEST: "test" } });
      try {
        const response = await server.fetch("/");

        expect(await response.json()).toEqual({
          FROM_CONFIG: "config",
          FROM_FILE: "file",
          FROM_TEST: "test",
        });
      } finally {
        await server.stop();
      }
    });
  },
);

// Playwright stops serve-workers.ts with SIGTERM, also when it does not start in time, and Ctrl-C
// sends SIGINT. Each test sends the signal to serve-workers.ts alone, not to the bundler.
describe.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
  "serve-workers.ts given %s while it bundles",
  (signal) => {
    it("kills the bundler, removes the bundle and exits with 128 plus the signal number", async () => {
      const tmp = emptyTmpdir();
      // Wrangler only accepts lowercase Worker names.
      const config = writeWorker(`signal-${signal.toLowerCase()}`, { build: HANGING_BUILD });
      const server = spawn("bun", [SERVE_WORKERS, config, "0"], {
        cwd: REPO_ROOT,
        env: { ...process.env, TMPDIR: tmp },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
      };
      server.stdout.on("data", collect);
      server.stderr.on("data", collect);
      const exitCode = new Promise<number | null>((done) => {
        server.once("exit", (code) => done(code));
      });
      let buildPid: number | undefined;
      try {
        buildPid = await vi.waitFor(
          () => {
            if (server.exitCode !== null || server.signalCode !== null) {
              throw new Error(`serve-workers.ts exited before the build started:\n${output}`);
            }
            return readBuildPid(config);
          },
          { timeout: 20_000, interval: 50 },
        );
        expect(bundlesIn(tmp)).toHaveLength(1);

        server.kill(signal);

        expect(await exitCode).toBe(128 + constants.signals[signal]);
        expect(bundlesIn(tmp)).toEqual([]);
        const build = buildPid;
        await vi.waitFor(() => expect(isRunning(build)).toBe(false), { timeout: 5000 });
      } finally {
        server.kill("SIGKILL");
        if (buildPid !== undefined && isRunning(buildPid)) {
          process.kill(buildPid, "SIGKILL");
        }
      }
    });
  },
);

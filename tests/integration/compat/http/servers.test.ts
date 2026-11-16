import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
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

/** Returns the process ID that HANGING_BUILD records, or undefined until it has recorded one. */
const readBuildPid = (configPath: string): number | undefined => {
  try {
    return Number(readFileSync(join(dirname(configPath), "build.pid"), "utf8")) || undefined;
  } catch {
    return undefined;
  }
};

interface BuildWait {
  /** Gives up after this many milliseconds. */
  readonly timeout?: number;
  /** Throws to report why the build cannot start. */
  readonly check?: () => void;
}

/** Waits until HANGING_BUILD has recorded its process ID, and returns it. */
const waitForBuild = (configPath: string, { timeout = 20_000, check }: BuildWait = {}) =>
  vi.waitFor(
    () => {
      check?.();
      const pid = readBuildPid(configPath);
      if (pid === undefined) {
        throw new Error("The custom build has not started yet");
      }
      return pid;
    },
    { timeout, interval: 50 },
  );

/** Whether a process runs. A zombie, which has exited but has not been reaped, does not. */
const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // `kill` also reaches zombies, which stay where PID 1 does not reap orphans, as in some
  // containers. Without `ps`, a zombie counts as running.
  const ps = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  return ps.error !== undefined || !ps.stdout.trim().startsWith("Z");
};

/** Kills HANGING_BUILD if it still runs, for a test that failed before the harness stopped it. */
const killBuild = (configPath: string) => {
  const pid = readBuildPid(configPath);
  if (pid !== undefined && isRunning(pid)) {
    process.kill(pid, "SIGKILL");
  }
};

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

/**
 * Stops what a test that failed halfway leaves running. serve-workers.ts gets SIGTERM first, so
 * that it can stop its bundler, which runs in a process group of its own.
 */
const stopLeftovers = async (server: ChildProcess, configPath: string) => {
  if (!hasExited(server)) {
    const exited = new Promise((done) => server.once("exit", done));
    server.kill("SIGTERM");
    await Promise.race([exited, sleep(5000)]);
    if (!hasExited(server)) {
      server.kill("SIGKILL");
    }
  }
  killBuild(configPath);
};

describe("startWorkerdServer", () => {
  it("stops a bundle step that hangs and its build, fails and removes the bundle", async () => {
    const tmp = useEmptyTmpdir();
    const config = writeWorker("hanging-build", { build: HANGING_BUILD });

    // Long enough for the build to start first, which takes about 0.4 s here.
    const starting = startWorkerdServer(config, { bundleTimeoutMs: 5000 });
    const failure = expect(starting).rejects.toThrow(
      `Bundling ${config} did not finish in 5 s, so it was stopped.`,
    );
    try {
      expect(bundlesIn(tmp)).toHaveLength(1);
      const build = await waitForBuild(config, { timeout: 4000 });

      await failure;
      expect(bundlesIn(tmp)).toEqual([]);
      await vi.waitFor(() => expect(isRunning(build)).toBe(false), { timeout: 5000 });
    } finally {
      killBuild(config);
    }
  });

  // Vitest's workers make `process.exit` throw while tests run.
  it("cleans up on a signal when process.exit throws, and runs the listeners after its own", async () => {
    const tmp = useEmptyTmpdir();
    const config = writeWorker("signal-without-exit", { build: HANGING_BUILD });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit is not allowed here");
    });
    const starting = startWorkerdServer(config);
    const failure = expect(starting).rejects.toThrow(`Bundling ${config} was stopped by SIGKILL.`);
    // Stands in for Miniflare's exit hook, which a server registers after the harness's listener.
    const nextListener = vi.fn();
    process.on("SIGTERM", nextListener);
    try {
      const build = await waitForBuild(config);
      expect(bundlesIn(tmp)).toHaveLength(1);

      process.kill(process.pid, "SIGTERM");

      await failure;
      expect(exit).toHaveBeenCalledWith(128 + constants.signals.SIGTERM);
      expect(nextListener).toHaveBeenCalledOnce();
      expect(bundlesIn(tmp)).toEqual([]);
      await vi.waitFor(() => expect(isRunning(build)).toBe(false), { timeout: 5000 });
    } finally {
      process.off("SIGTERM", nextListener);
      exit.mockRestore();
      killBuild(config);
    }
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
      try {
        const build = await waitForBuild(config, {
          check: () => {
            if (hasExited(server)) {
              throw new Error(`serve-workers.ts exited before the build started:\n${output}`);
            }
          },
        });
        expect(bundlesIn(tmp)).toHaveLength(1);

        server.kill(signal);

        expect(await exitCode).toBe(128 + constants.signals[signal]);
        expect(bundlesIn(tmp)).toEqual([]);
        await vi.waitFor(() => expect(isRunning(build)).toBe(false), { timeout: 5000 });
      } finally {
        await stopLeftovers(server, config);
      }
    });
  },
);

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare, type Json } from "miniflare";
import {
  unstable_getMiniflareWorkerOptions,
  unstable_readConfig,
  unstable_splitSqlQuery,
  type Unstable_Config,
} from "wrangler";
import type { Target } from "../shared/target";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const COMPAT_DIRECTORY = resolve(import.meta.dirname, "..");
const STARTUP_TIMEOUT_MS = 60_000;
const READY_LINE = /listening on (http:\/\/\S+)/;

export interface Server extends Target {
  readonly url: string;
  stop(): Promise<void>;
}

interface ServerCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

/** Starts a server process and waits for the line that announces its address. */
const startServer = ({ command, args, cwd = REPO_ROOT, env }: ServerCommand): Promise<Server> =>
  new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`${args.join(" ")} did not start in time. Output:\n${output}`));
    }, STARTUP_TIMEOUT_MS);
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      fail(new Error(`${args.join(" ")} exited with code ${code}. Output:\n${output}`));
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const url = output.match(READY_LINE)?.[1]?.replace(/\/$/, "");
      if (!url) {
        return;
      }
      clearTimeout(timer);
      child.off("exit", onExit);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      // Keep draining so that a chatty server cannot block on a full pipe.
      child.stdout.resume();
      child.stderr.resume();
      done({
        url,
        fetch: (path, init) => fetch(`${url}${path}`, init),
        stop: () =>
          new Promise((stopped) => {
            child.once("exit", () => stopped());
            child.kill();
          }),
      });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });

/** Runs an entry file in its own Bun process, the way a self-hosted deployment does. */
export const startBunServer = (entry: string): Promise<Server> =>
  startServer({
    command: "bun",
    args: [resolve(REPO_ROOT, entry)],
    env: { PORT: "0", HOST: "127.0.0.1" },
  });

/**
 * Kills a bundler and every process it started, which share its process group. Once Wrangler has
 * exited, its process group ID may belong to someone else, so nothing is killed then. Wrangler
 * waits for a custom build, and esbuild stops when Wrangler exits.
 */
const killBundler = (bundler: ChildProcess) => {
  if (bundler.pid === undefined || bundler.exitCode !== null || bundler.signalCode !== null) {
    return;
  }
  try {
    process.kill(-bundler.pid, "SIGKILL");
  } catch {
    // Every process in the group has already exited.
  }
};

// Bundle directories that still exist, and the bundlers still writing into them.
const bundleDirectories = new Set<string>();
const bundlers = new Set<ChildProcess>();

/** Kills the bundlers, so that none can write a bundle back, and then removes the bundles. */
const removeBundles = () => {
  for (const bundler of bundlers) {
    killBundler(bundler);
  }
  for (const directory of bundleDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
};

// Also for a process that exits without returning to `stop`.
process.on("exit", removeBundles);

// While a bundle directory exists, SIGINT, SIGTERM and SIGHUP remove the bundles and exit the
// process with 128 plus the signal number, as Miniflare's exit hook does. Miniflare's hook only
// exists from `new Miniflare()` until `dispose()`. The signal-exit listeners that Wrangler loads do
// nothing while another listener exists, and otherwise re-raise the signal, which ends the process
// without the exit event.
const EXIT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const exitOnSignal = (signal: NodeJS.Signals) => {
  removeBundles();
  try {
    process.exit(128 + constants.signals[signal]);
  } catch {
    // Vitest's workers make `process.exit` throw while tests run, and Vitest would report the
    // throw as an unhandled error and fail the run. Such a worker exits when Vitest stops it, or
    // when its next message to Vitest fails because Vitest has exited.
  }
};

const createBundleDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "davloom-worker-"));
  if (bundleDirectories.size === 0) {
    for (const signal of EXIT_SIGNALS) {
      process.on(signal, exitOnSignal);
    }
  }
  bundleDirectories.add(directory);
  return directory;
};

const removeBundleDirectory = (directory: string) => {
  rmSync(directory, { recursive: true, force: true });
  bundleDirectories.delete(directory);
  if (bundleDirectories.size === 0) {
    for (const signal of EXIT_SIGNALS) {
      process.off(signal, exitOnSignal);
    }
  }
};

/** Returns the path of the one module that a bundle directory holds. */
const findModule = (outdir: string): string => {
  const modules = readdirSync(outdir).filter((file) => file.endsWith(".js"));
  if (modules.length !== 1 || !modules[0]) {
    throw new Error(`Expected one module in ${outdir}, found: ${modules.join(", ")}`);
  }
  return join(outdir, modules[0]);
};

/**
 * Bundles a Worker the way `wrangler deploy` does, and returns the path of its one module.
 * It runs Wrangler asynchronously, because `spawnSync` blocks the event loop, which keeps both
 * `timeoutMs` and a test's hook timeout from firing. Wrangler runs in a process group of its own,
 * so that stopping it also stops esbuild, which writes the bundle, and any custom build.
 */
const bundleWorker = (configPath: string, outdir: string, timeoutMs: number): Promise<string> =>
  new Promise((done, fail) => {
    // The compat package holds the Wrangler that `bun.lock` records; the repository root has none.
    const bundler = spawn(
      "bunx",
      ["--bun", "wrangler", "deploy", "--dry-run", "--outdir", outdir, "--config", configPath],
      {
        cwd: COMPAT_DIRECTORY,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );
    bundlers.add(bundler);
    bundler.once("exit", () => bundlers.delete(bundler));
    let output = "";
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    bundler.stdout.on("data", collect);
    bundler.stderr.on("data", collect);
    const timer = setTimeout(() => {
      killBundler(bundler);
      fail(
        new Error(
          `Bundling ${configPath} did not finish in ${timeoutMs / 1000} s, so it was stopped. Output:\n${output}`,
        ),
      );
    }, timeoutMs);
    bundler.once("error", (error) => {
      clearTimeout(timer);
      bundlers.delete(bundler);
      fail(new Error(`Bundling ${configPath} could not start`, { cause: error }));
    });
    bundler.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        const reason = signal ? `was stopped by ${signal}` : `failed with exit code ${code}`;
        fail(new Error(`Bundling ${configPath} ${reason}. Output:\n${output}`));
        return;
      }
      try {
        done(findModule(outdir));
      } catch (error) {
        fail(error);
      }
    });
  });

/**
 * Applies each D1 database's migrations, the files that `wrangler d1 migrations apply` reads.
 * Wrangler resolves `migrations_dir` against the directory of the config file, `configDirectory`.
 */
const applyD1Migrations = async (
  miniflare: Miniflare,
  config: Unstable_Config,
  configDirectory: string,
) => {
  for (const { binding, migrations_dir = "migrations" } of config.d1_databases) {
    const directory = resolve(configDirectory, migrations_dir);
    const database = await miniflare.getD1Database(binding);
    const files = readdirSync(directory)
      .filter((file) => file.endsWith(".sql"))
      .toSorted();
    for (const file of files) {
      const statements = unstable_splitSqlQuery(readFileSync(join(directory, file), "utf8"));
      await database.batch(statements.map((statement) => database.prepare(statement)));
    }
  }
};

/** Wrangler's types leave the vars it derives for Miniflare unknown. */
const isVarRecord = (value: unknown): value is Readonly<Record<string, Json>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface WorkerdOptions {
  /**
   * Replaces vars from the Wrangler config and from a `.dev.vars` or `.env` file beside it, like
   * `wrangler dev --var`.
   */
  readonly vars?: Readonly<Record<string, string>>;
  /** Listens on this port instead of one the system picks. */
  readonly port?: number;
  /**
   * Stops bundling and fails after this many milliseconds. The default is the 60 s that a server
   * gets to start.
   */
  readonly bundleTimeoutMs?: number;
}

/**
 * Runs a Worker in local workerd through Miniflare, bundled the way `wrangler deploy` bundles it.
 * Its D1 databases start empty, with the migrations from its Wrangler config applied.
 *
 * Requests go to Miniflare's own URL. Under Bun, `wrangler dev` answers them with 503 and
 * `Miniflare.dispatchFetch` cannot reach the Worker, because both route requests through an undici
 * dispatcher that Bun's `fetch` ignores.
 */
export const startWorkerdServer = async (
  configPath: string,
  { vars = {}, port = 0, bundleTimeoutMs = STARTUP_TIMEOUT_MS }: WorkerdOptions = {},
): Promise<Server> => {
  const configFile = resolve(REPO_ROOT, configPath);
  const outdir = createBundleDirectory();
  let miniflare: Miniflare | undefined;
  const stop = async () => {
    try {
      await miniflare?.dispose();
    } finally {
      removeBundleDirectory(outdir);
    }
  };
  try {
    const scriptPath = await bundleWorker(configFile, outdir, bundleTimeoutMs);
    const config = unstable_readConfig({ config: configFile });
    const { workerOptions, externalWorkers } = unstable_getMiniflareWorkerOptions(config);
    if (externalWorkers.length > 0) {
      throw new Error(
        `${configPath} needs Workers beside its own, which this harness cannot start`,
      );
    }
    // The config's vars, some of which a `.dev.vars` or `.env` beside the config may have replaced.
    const { bindings: configVars = {} } = workerOptions;
    if (!isVarRecord(configVars)) {
      throw new Error(`Wrangler did not derive a record of vars from ${configPath}`);
    }
    miniflare = new Miniflare(
      convertV4MiniflareOptions({
        ...workerOptions,
        // The vars passed in go over those, where `wrangler dev --var` puts them.
        bindings: { ...configVars, ...vars },
        // The bundle is a single module, which needs no rules, and Miniflare 5 cannot convert them.
        modulesRules: undefined,
        modules: true,
        modulesRoot: outdir,
        scriptPath,
        host: "127.0.0.1",
        port,
      }),
    );
    const url = (await miniflare.ready).href.replace(/\/$/, "");
    await applyD1Migrations(miniflare, config, dirname(configFile));
    return { url, fetch: (path, init) => fetch(`${url}${path}`, init), stop };
  } catch (error) {
    // Reports why the start failed, not why the cleanup after it did.
    await stop().catch(() => undefined);
    throw error;
  }
};

export interface Runtime {
  readonly name: string;
  readonly start: () => Promise<Server>;
}

export const productionRuntimes: readonly Runtime[] = [
  { name: "Bun", start: () => startBunServer("apps/api/src/entry.bun.ts") },
  { name: "Workers", start: () => startWorkerdServer("apps/api/wrangler.jsonc") },
];

export const probeRuntimes: readonly Runtime[] = [
  { name: "Bun", start: () => startBunServer("tests/integration/compat/probe/entry.bun.ts") },
  {
    name: "Workers",
    start: () => startWorkerdServer("tests/integration/compat/probe/wrangler.jsonc"),
  },
];

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
  unstable_getMiniflareWorkerOptions,
  unstable_readConfig,
  unstable_splitSqlQuery,
  type Unstable_Config,
} from "wrangler";
import type { Target } from "../shared/target";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
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

/** Bundles a Worker the way `wrangler deploy` does, and returns the path of its one module. */
const bundleWorker = (configPath: string, outdir: string): string => {
  const { status, stdout, stderr } = spawnSync(
    "bunx",
    ["--bun", "wrangler", "deploy", "--dry-run", "--outdir", outdir, "--config", configPath],
    { cwd: REPO_ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, encoding: "utf8" },
  );
  if (status !== 0) {
    throw new Error(`Bundling ${configPath} failed:\n${stdout}${stderr}`);
  }
  const modules = readdirSync(outdir).filter((file) => file.endsWith(".js"));
  if (modules.length !== 1 || !modules[0]) {
    throw new Error(`Expected one module in ${outdir}, found: ${modules.join(", ")}`);
  }
  return join(outdir, modules[0]);
};

/** Applies each D1 database's migrations, the files that `wrangler d1 migrations apply` reads. */
const applyD1Migrations = async (miniflare: Miniflare, config: Unstable_Config) => {
  for (const { binding, migrations_dir = "migrations" } of config.d1_databases) {
    const directory = resolve(dirname(config.configPath ?? REPO_ROOT), migrations_dir);
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

export interface WorkerdOptions {
  /** Replaces vars from the Wrangler config, like `wrangler dev --var`. */
  readonly vars?: Readonly<Record<string, string>>;
  /** Listens on this port instead of one the system picks. */
  readonly port?: number;
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
  { vars = {}, port = 0 }: WorkerdOptions = {},
): Promise<Server> => {
  const configFile = resolve(REPO_ROOT, configPath);
  const outdir = mkdtempSync(join(tmpdir(), "davloom-worker-"));
  let miniflare: Miniflare | undefined;
  const stop = async () => {
    await miniflare?.dispose();
    rmSync(outdir, { recursive: true, force: true });
  };
  try {
    const scriptPath = bundleWorker(configFile, outdir);
    const config = unstable_readConfig({ config: configFile });
    const { workerOptions } = unstable_getMiniflareWorkerOptions({
      ...config,
      vars: { ...config.vars, ...vars },
    });
    miniflare = new Miniflare(
      convertV4MiniflareOptions({
        ...workerOptions,
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
    await applyD1Migrations(miniflare, config);
    return { url, fetch: (path, init) => fetch(`${url}${path}`, init), stop };
  } catch (error) {
    await stop();
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

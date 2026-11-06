import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Target } from "../shared/target";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const STARTUP_TIMEOUT_MS = 60_000;
const READY_LINE = /(?:listening on|Ready on) (http:\/\/\S+)/;

export interface Server extends Target {
  readonly url: string;
  readonly pid: number;
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
        pid: child.pid ?? -1,
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

const WRANGLER_ENV = { WRANGLER_SEND_METRICS: "false" };

const startWranglerDev = (config: string, extraArgs: readonly string[] = []): Promise<Server> =>
  startServer({
    command: "bunx",
    args: [
      "wrangler",
      "dev",
      "--config",
      config,
      "--ip",
      "127.0.0.1",
      "--port",
      "0",
      "--inspector-port",
      "0",
      "--show-interactive-dev-session=false",
      ...extraArgs,
    ],
    env: WRANGLER_ENV,
  });

/** Runs a Worker in local workerd through `wrangler dev`, including its bundling and startup. */
export const startWorkerdServer = (configPath: string): Promise<Server> =>
  startWranglerDev(resolve(REPO_ROOT, configPath));

/** The same, with a throwaway local D1 database that has the repository's migrations applied. */
export const startWorkerdServerWithDatabase = async (
  configPath: string,
  extraArgs: readonly string[] = [],
): Promise<Server> => {
  const config = resolve(REPO_ROOT, configPath);
  const persistTo = mkdtempSync(join(tmpdir(), "davloom-d1-"));
  const migration = spawnSync(
    "bunx",
    [
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      persistTo,
      "--config",
      config,
    ],
    { cwd: REPO_ROOT, env: { ...process.env, ...WRANGLER_ENV, CI: "true" }, encoding: "utf8" },
  );
  if (migration.status !== 0) {
    throw new Error(`Applying D1 migrations failed:\n${migration.stdout}${migration.stderr}`);
  }
  const server = await startWranglerDev(config, ["--persist-to", persistTo, ...extraArgs]);
  return {
    ...server,
    stop: async () => {
      await server.stop();
      rmSync(persistTo, { recursive: true, force: true });
    },
  };
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
    start: () => startWorkerdServerWithDatabase("tests/integration/compat/probe/wrangler.jsonc"),
  },
];

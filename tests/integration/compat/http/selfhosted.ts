import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OFFLINE_VARS, SECRET } from "./davloom";
import { startBunServer, type Server } from "./servers";

// The self-hosted deployment: the Bun entry with SQLite, and RustFS in Docker as its S3-compatible
// storage, the way deploy/docker/compose.yaml runs them.

export const RUSTFS_IMAGE =
  "rustfs/rustfs:1.0.6@sha256:ee717072290bec9b11abfc0365f8310b00df1cd9b3639943edae47bdef05044a";
export const ACCESS_KEY = "davloom";
export const SECRET_KEY = "davloom-selfhosted-test-secret";

export const hasDocker = () => spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

const docker = (...args: string[]) => {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
};

const waitFor = async (url: string, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  throw new Error(`${url} did not answer in time`);
};

export interface SelfHostedOptions {
  /**
   * The endpoint the Bun server is to use, given RustFS's own; such as a proxy in front of it
   * (s3-proxy.ts). RustFS's own when absent.
   */
  readonly endpointFor?: (rustfs: string) => string;
}

/** Starts RustFS and the Bun server; stopping the server also removes RustFS and the data. */
export const startSelfHostedServer = async ({
  endpointFor = (rustfs) => rustfs,
}: SelfHostedOptions = {}): Promise<Server> => {
  const container = docker(
    "run",
    "-d",
    "--rm",
    "-p",
    "127.0.0.1::9000",
    "-e",
    `RUSTFS_ACCESS_KEY=${ACCESS_KEY}`,
    "-e",
    `RUSTFS_SECRET_KEY=${SECRET_KEY}`,
    RUSTFS_IMAGE,
  );
  const dataDir = mkdtempSync(join(tmpdir(), "davloom-selfhosted-"));
  try {
    const port = docker("port", container, "9000/tcp").split("\n")[0]?.split(":").at(-1) ?? "";
    const endpoint = `http://127.0.0.1:${port}`;
    await waitFor(endpoint, 30_000);
    const server = await startBunServer("apps/api/src/entry.bun.ts", {
      DAVLOOM_SECRET: SECRET,
      ...OFFLINE_VARS,
      DAVLOOM_DATA_DIR: dataDir,
      DAVLOOM_S3_ENDPOINT: endpointFor(endpoint),
      DAVLOOM_S3_ACCESS_KEY_ID: ACCESS_KEY,
      DAVLOOM_S3_SECRET_ACCESS_KEY: SECRET_KEY,
      DAVLOOM_S3_BUCKET: "davloom",
    });
    return {
      ...server,
      stop: async () => {
        await server.stop();
        spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
};

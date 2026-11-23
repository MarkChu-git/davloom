import { ListBucketsCommand } from "@aws-sdk/client-s3";
import type { TestProject } from "vitest/node";
import { createS3Client, type S3Config } from "../src/s3";

// Starts RustFS in Docker for the S3 contract run, on a free port of the loopback interface, and
// removes the container afterwards. Testcontainers is not needed: one `docker run` and one
// `docker rm` through Bun's spawn do the same here.

const IMAGE = "rustfs/rustfs:1.0.6";
// Test credentials of a throwaway container that listens on 127.0.0.1 only.
const ACCESS_KEY = "davloom-test-access";
const SECRET_KEY = "davloom-test-secret-not-real"; // gitleaks:allow (a throwaway container's key)

export type RustfsConfig = Omit<S3Config, "bucket">;

declare module "vitest" {
  interface ProvidedContext {
    rustfs: RustfsConfig;
  }
}

const run = async (args: string[]) => {
  const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`docker ${args[0] ?? ""} failed: ${stderr.trim()}`);
  return stdout.trim();
};

const waitUntilReady = async (config: RustfsConfig) => {
  const client = createS3Client({ ...config, bucket: "" });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await client.send(new ListBucketsCommand({}));
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await Bun.sleep(250);
    }
  }
};

export default async function setup(project: TestProject) {
  const name = `davloom-rustfs-${crypto.randomUUID().slice(0, 8)}`;
  await run([
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--publish",
    "127.0.0.1::9000",
    "--env",
    `RUSTFS_ACCESS_KEY=${ACCESS_KEY}`,
    "--env",
    `RUSTFS_SECRET_KEY=${SECRET_KEY}`,
    IMAGE,
  ]);
  const teardown = async () => {
    await run(["rm", "--force", name]);
  };
  try {
    // "127.0.0.1:49153"
    const address = (await run(["port", name, "9000/tcp"])).split("\n")[0] ?? "";
    const config: RustfsConfig = {
      endpoint: `http://${address}`,
      region: "us-east-1",
      forcePathStyle: true,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    };
    await waitUntilReady(config);
    project.provide("rustfs", config);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}

// Runs the Cloud Free measurements on a real Cloudflare account. It needs `wrangler login` and no
// payment method, because it only uses Workers, D1 and Durable Objects.
//
// Usage: bun scripts/cloud-free.ts <deploy|measure|destroy|all>
//   deploy   creates a D1 database and deploys the probe behind a one-time token
//   measure  runs cloud/cloud-free.test.ts against that deployment
//   destroy  deletes the Durable Object data, the Worker and the database, then confirms by listing
//   all      does all three, and destroys the deployment even if an earlier step fails
//
// Durable Objects may write 100,000 rows a day on the Free plan, and one run writes about 31,000.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Schema } from "effect";
import { PROBE_TOKEN_HEADER } from "../probe/token-guard";
import { decodeJson } from "../shared/json";

const WORKER_NAME = "davloom-probe";
const HEALTH_PATH = "/api/health";
const PROPAGATION_TIMEOUT_MS = 120_000;
const PROPAGATION_POLL_MS = 2000;
const DELETION_CHECKS = 6;
const DELETION_CHECK_INTERVAL_MS = 5000;

const COMPAT_DIRECTORY = resolve(import.meta.dirname, "..");
const RESULTS_DIRECTORY = resolve(COMPAT_DIRECTORY, "test-results/cloud-free");
const STATE_FILE = resolve(RESULTS_DIRECTORY, "state.json");
const DEPLOYMENT_FILE = resolve(RESULTS_DIRECTORY, "deployment.json");
const BASE_CONFIG = resolve(COMPAT_DIRECTORY, "probe/wrangler.jsonc");
// Next to the base config, because Wrangler resolves relative paths from the config's directory.
const CLOUD_CONFIG = resolve(COMPAT_DIRECTORY, "probe/wrangler.cloud.generated.jsonc");

const State = Schema.Struct({
  databaseName: Schema.String,
  token: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
});
type State = typeof State.Type;

const D1DatabaseList = Schema.Array(Schema.Struct({ name: Schema.String, uuid: Schema.String }));

// The rest signature keeps every other key of wrangler.jsonc, which deploy copies over.
const ProbeConfig = Schema.StructWithRest(
  Schema.Struct({ d1_databases: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

interface WranglerResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

const wrangler = (...args: string[]): WranglerResult => {
  const { exitCode, stdout, stderr } = Bun.spawnSync(["bunx", "--bun", "wrangler", ...args], {
    cwd: COMPAT_DIRECTORY,
    // CI keeps Wrangler from asking questions, since nobody can answer them here.
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { ok: exitCode === 0, stdout: stdout.toString(), stderr: stderr.toString() };
};

const required = (description: string, result: WranglerResult): WranglerResult => {
  if (!result.ok) {
    throw new Error(`${description} failed:\n${result.stdout}\n${result.stderr}`);
  }
  console.log(`${description}: done`);
  return result;
};

const readState = async (): Promise<State | null> =>
  existsSync(STATE_FILE) ? decodeJson(State, await Bun.file(STATE_FILE).json()) : null;

const writeState = (state: State) => Bun.write(STATE_FILE, JSON.stringify(state, null, 2));

const workerExists = () => wrangler("deployments", "list", "--name", WORKER_NAME).ok;

const listDatabaseIds = (): Map<string, string> => {
  const databases = decodeJson(
    D1DatabaseList,
    JSON.parse(required("List D1 databases", wrangler("d1", "list", "--json")).stdout),
  );
  return new Map(databases.map(({ name, uuid }) => [name, uuid]));
};

const waitForHealth = async (url: string, token: string) => {
  const deadline = Date.now() + PROPAGATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}${HEALTH_PATH}`, {
      headers: { [PROBE_TOKEN_HEADER]: token },
    }).catch(() => null);
    if (response?.status === 200) {
      return;
    }
    await Bun.sleep(PROPAGATION_POLL_MS);
  }
  throw new Error(`The Worker did not answer at ${url} in time`);
};

const deploy = async () => {
  if (await readState()) {
    throw new Error(`${STATE_FILE} exists, so a deployment may be running. Destroy it first.`);
  }
  if (workerExists()) {
    throw new Error(
      `This account already has a Worker named ${WORKER_NAME}, so nothing was changed.`,
    );
  }

  mkdirSync(RESULTS_DIRECTORY, { recursive: true });
  const databaseName = `${WORKER_NAME}-${randomBytes(4).toString("hex")}`;
  const token = randomBytes(32).toString("hex");
  // Written first, so that destroy can find the database if a later step fails.
  await writeState({ databaseName });

  required("Create the D1 database", wrangler("d1", "create", databaseName));
  const databaseId = listDatabaseIds().get(databaseName);
  if (!databaseId) {
    throw new Error(`The new database ${databaseName} is not in the account's list`);
  }

  const base = decodeJson(ProbeConfig, Bun.JSONC.parse(await Bun.file(BASE_CONFIG).text()));
  await Bun.write(
    CLOUD_CONFIG,
    JSON.stringify(
      {
        ...base,
        workers_dev: true,
        vars: { AUTH_SECRET: randomBytes(32).toString("hex"), PROBE_TOKEN: token },
        d1_databases: [
          { ...base.d1_databases[0], database_name: databaseName, database_id: databaseId },
        ],
      },
      null,
      2,
    ),
  );

  required(
    "Apply the D1 migrations",
    wrangler("d1", "migrations", "apply", "DB", "--remote", "--config", CLOUD_CONFIG),
  );
  const deployed = required(
    "Deploy the probe Worker",
    wrangler("deploy", "--config", CLOUD_CONFIG),
  );
  const output = `${deployed.stdout}\n${deployed.stderr}`;
  const url = output.match(/https:\/\/\S+\.workers\.dev/)?.[0];
  if (!url) {
    throw new Error(`Wrangler did not print a workers.dev address:\n${output}`);
  }
  await writeState({ databaseName, token, url });

  await waitForHealth(url, token);
  const unguarded = await fetch(`${url}${HEALTH_PATH}`);
  if (unguarded.status !== 404) {
    throw new Error(`The probe answered ${unguarded.status} without its token`);
  }

  const size = output.match(/Total Upload: ([\d.]+ \w+) \/ gzip: ([\d.]+ \w+)/);
  await Bun.write(
    DEPLOYMENT_FILE,
    JSON.stringify(
      {
        deployedAt: new Date().toISOString(),
        upload: size?.[1] ?? null,
        gzip: size?.[2] ?? null,
        startupMs: Number(output.match(/Worker Startup Time: (\d+) ms/)?.[1] ?? Number.NaN),
      },
      null,
      2,
    ),
  );
  console.log(`Deployed. Size and startup time are in ${DEPLOYMENT_FILE}`);
};

const measure = async () => {
  const state = await readState();
  if (!state?.url || !state.token) {
    throw new Error("Nothing is deployed. Run deploy first.");
  }
  const { exitCode } = Bun.spawnSync(["bun", "--bun", "run", "test:cloud"], {
    cwd: COMPAT_DIRECTORY,
    env: {
      ...process.env,
      DAVLOOM_PROBE_URL: state.url,
      DAVLOOM_PROBE_TOKEN: state.token,
      DAVLOOM_PROBE_WORKER: WORKER_NAME,
      DAVLOOM_PROBE_CONFIG: CLOUD_CONFIG,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (exitCode !== 0) {
    throw new Error(`The measurements exited with code ${exitCode}`);
  }
};

const destroy = async () => {
  const state = await readState();
  if (!state) {
    throw new Error(`${STATE_FILE} does not exist, so this run has nothing it knows to delete.`);
  }

  // Deleting the class from the code and declaring it deleted is what removes its stored data.
  await Bun.write(
    CLOUD_CONFIG,
    JSON.stringify(
      {
        name: WORKER_NAME,
        main: "tombstone.workers.ts",
        compatibility_date: "2026-11-04",
        exports: { ProbeStore: { type: "durable-object", state: "deleted" } },
      },
      null,
      2,
    ),
  );
  const tombstone = wrangler("deploy", "--config", CLOUD_CONFIG);
  console.log(`Delete the Durable Object namespace: ${tombstone.ok ? "done" : "failed"}`);
  const worker = wrangler("delete", WORKER_NAME, "--force");
  console.log(`Delete the Worker: ${worker.ok ? "done" : "failed"}`);
  const database = wrangler("d1", "delete", state.databaseName, "--skip-confirmation");
  console.log(`Delete the D1 database: ${database.ok ? "done" : "failed"}`);

  // The listings decide the outcome, so that rerunning after a partial failure can still succeed.
  // A deletion can take a moment to reach them.
  const listRemaining = () => [
    ...(workerExists() ? [`Worker ${WORKER_NAME}`] : []),
    ...(listDatabaseIds().has(state.databaseName) ? [`D1 database ${state.databaseName}`] : []),
  ];
  let remaining = listRemaining();
  for (let attempt = 0; attempt < DELETION_CHECKS && remaining.length > 0; attempt += 1) {
    await Bun.sleep(DELETION_CHECK_INTERVAL_MS);
    remaining = listRemaining();
  }
  if (remaining.length > 0 || !tombstone.ok) {
    console.error(tombstone.stdout, tombstone.stderr, worker.stderr, database.stderr);
    throw new Error(`Cleanup is incomplete. Still present: ${remaining.join(", ") || "unknown"}`);
  }

  rmSync(STATE_FILE, { force: true });
  rmSync(CLOUD_CONFIG, { force: true });
  console.log("Confirmed by listing: the Worker and the D1 database no longer exist.");
};

const all = async () => {
  try {
    await deploy();
    await measure();
  } finally {
    // Nothing is known to be ours without a state file, for example when deploy refused to start.
    if (await readState()) {
      await destroy();
    }
  }
};

const COMMANDS: Record<string, () => Promise<void>> = { deploy, measure, destroy, all };

const command = COMMANDS[process.argv[2] ?? ""];
if (!command) {
  console.error("Usage: bun scripts/cloud-free.ts <deploy|measure|destroy|all>");
  process.exit(1);
}
await command();

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CLIENT_IP_HEADER,
  configuredOrigin,
  createAuth,
  createIdentity,
  leakedPasswordCheckFrom,
  rateLimitFrom,
} from "@davloom/auth";
import {
  Archive,
  credentialCipherLayer,
  Identity,
  createOperationRecorder,
  InstanceConfig,
  InstanceSettings,
  makeCredentialCipher,
  OperationLog,
  Records,
  setupTokenFrom,
  StorageOpener,
} from "@davloom/core";
import { createOperationLog, createSettingsStore } from "@davloom/database/instance-data";
import { createArchive } from "@davloom/database/archive";
import {
  bunSqliteAtomic,
  createBunSqliteDatabase,
  migrateBunSqliteDatabase,
} from "@davloom/database/bun-sqlite";
import { createSqlPropertyStore } from "@davloom/database/properties";
import { createRepositories } from "@davloom/database/repositories";
import { openS3Backend, unsealWith } from "@davloom/storage/open-s3";
import { Effect, Layer, Redacted } from "effect";
import type { Instance } from "./app";
import { createSqlLockStore } from "./locks";

// The self-hosted instance: Bun SQLite for records, S3-compatible storage (such as RustFS) for files.

const MIN_SECRET_BYTES = 32;

/**
 * The most objects one copy or move touches (PRD §5). Bun has no subrequest limit; 1,000 keeps a
 * move's removal of its source to one batch delete.
 */
const S3_MAX_ENTRIES = 1000;

export type BunEnv = Readonly<Record<string, string | undefined>>;

/** The S3-compatible backend registration creates, from DAVLOOM_S3_* variables, or null. */
export const defaultS3Backend = (env: BunEnv) => {
  if (!env.DAVLOOM_S3_ENDPOINT) return null;
  return {
    kind: "s3",
    config: {
      endpoint: env.DAVLOOM_S3_ENDPOINT,
      region: env.DAVLOOM_S3_REGION ?? "us-east-1",
      bucket: env.DAVLOOM_S3_BUCKET ?? "davloom",
      prefix: env.DAVLOOM_S3_PREFIX ?? "",
      forcePathStyle: env.DAVLOOM_S3_FORCE_PATH_STYLE !== "false",
      accessKeyId: env.DAVLOOM_S3_ACCESS_KEY_ID ?? "",
    },
    secretKey: env.DAVLOOM_S3_SECRET_ACCESS_KEY
      ? Redacted.make(env.DAVLOOM_S3_SECRET_ACCESS_KEY)
      : null,
  };
};

/** Builds the instance for a Bun process; `env` is usually process.env. */
export const bunInstance =
  (env: BunEnv) =>
  (origin: string): Instance => {
    const secret = env.DAVLOOM_SECRET ?? "";
    if (new TextEncoder().encode(secret).length < MIN_SECRET_BYTES) {
      throw new Error(`DAVLOOM_SECRET must be set to at least ${MIN_SECRET_BYTES} bytes`);
    }
    const dataDir = env.DAVLOOM_DATA_DIR ?? "./data";
    mkdirSync(dataDir, { recursive: true });
    const sqlite = new Database(join(dataDir, "davloom.sqlite"), { create: true });
    sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    const db = createBunSqliteDatabase(sqlite);
    migrateBunSqliteDatabase(db);
    const repositories = createRepositories(db);
    const auth = createAuth({
      database: db,
      secret,
      baseURL: configuredOrigin(env.DAVLOOM_URL) ?? origin,
      checkLeakedPasswords: leakedPasswordCheckFrom(env.DAVLOOM_CHECK_LEAKED_PASSWORDS),
      rateLimit: rateLimitFrom(env.DAVLOOM_AUTH_RATE_LIMIT),
      // node-server.bun.ts sets it to the socket's address, replacing any value the client sent.
      clientIpHeaders: [CLIENT_IP_HEADER],
      passkeyOrigin: configuredOrigin(env.DAVLOOM_URL),
    });
    const cipher = Effect.runPromise(makeCredentialCipher(Redacted.make(secret)));
    const unseal = async (backendId: string, sealed: string) =>
      await unsealWith(await cipher)(backendId, sealed);
    const operationLog = createOperationLog(db, bunSqliteAtomic(db));
    const sqliteVersion =
      sqlite.query<{ version: string }, []>("SELECT sqlite_version() AS version").get()?.version ??
      "";
    const layer = Layer.mergeAll(
      Layer.succeed(Records, repositories),
      Layer.succeed(Archive, createArchive(db, bunSqliteAtomic(db))),
      Layer.succeed(OperationLog, operationLog),
      Layer.succeed(InstanceSettings, createSettingsStore(db)),
      Layer.succeed(Identity, createIdentity(auth)),
      Layer.succeed(StorageOpener, {
        open: (backend) =>
          backend.kind === "s3"
            ? openS3Backend(backend, unseal, createSqlPropertyStore(db, backend.id), S3_MAX_ENTRIES)
            : null,
      }),
      Layer.succeed(InstanceConfig, {
        storageKinds: ["s3"],
        defaultBackend: defaultS3Backend(env),
        setupToken: setupTokenFrom(env.DAVLOOM_SETUP_TOKEN),
        passkeys: configuredOrigin(env.DAVLOOM_URL) !== undefined,
      }),
      credentialCipherLayer(Redacted.make(secret)),
    );
    return {
      layer,
      authHandler: (request) => auth.handler(request),
      locks: createSqlLockStore(repositories.locks),
      operations: createOperationRecorder({
        write: operationLog.add,
        schedule: (task) => void task,
        delayMs: 10_000,
      }),
      about: () => ({
        runtime: `Bun ${Bun.version}`,
        deployment: "Self-hosted",
        region: Intl.DateTimeFormat().resolvedOptions().timeZone,
        database: `SQLite ${sqliteVersion}`.trim(),
      }),
    };
  };

/**
 * Creates the bucket that DAVLOOM_S3_* names when it does not exist yet, so a fresh RustFS works at
 * once. A bucket that exists, or a store that refuses, changes nothing: the backend then reports
 * itself unavailable until the bucket is there.
 */
export const ensureDefaultBucket = async (env: BunEnv): Promise<void> => {
  const backend = defaultS3Backend(env);
  if (!backend?.secretKey) return;
  const { createS3Client } = await import("@davloom/storage/s3");
  const { CreateBucketCommand, HeadBucketCommand } = await import("@aws-sdk/client-s3");
  const client = createS3Client({
    ...backend.config,
    secretAccessKey: Redacted.value(backend.secretKey),
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: backend.config.bucket }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: backend.config.bucket }));
      console.log(`created the bucket ${backend.config.bucket}`);
    } catch (error) {
      console.error(
        `could not create the bucket ${backend.config.bucket}:`,
        error instanceof Error ? error.message : error,
      );
    }
  } finally {
    client.destroy();
  }
};

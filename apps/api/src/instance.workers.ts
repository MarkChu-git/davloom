import { env, waitUntil } from "cloudflare:workers";
import {
  configuredOrigin,
  createAuth,
  createIdentity,
  leakedPasswordCheckFrom,
  rateLimitFrom,
} from "@davloom/auth";
import {
  Archive,
  checkR2Config,
  createOperationRecorder,
  credentialCipherLayer,
  Identity,
  InstanceConfig,
  InstanceSettings,
  makeCredentialCipher,
  OperationLog,
  Records,
  setupTokenFrom,
  StorageOpener,
} from "@davloom/core";
import { createSqlPropertyStore } from "@davloom/database/properties";
import { createObjectStoreStorage } from "@davloom/storage/object-store";
import { openS3Backend, unsealWith } from "@davloom/storage/open-s3";
import { createR2Driver } from "@davloom/storage/r2";
import { withUsageCache } from "@davloom/storage/usage-cache";
import { createArchive } from "@davloom/database/archive";
import { createOperationLog, createSettingsStore } from "@davloom/database/instance-data";
import { createD1Database, d1Atomic } from "@davloom/database/d1";
import { createRepositories } from "@davloom/database/repositories";
import { durableObjectStorage, type StorageObject } from "@davloom/storage/durable-object";
import { Effect, Layer, Redacted } from "effect";
import type { Instance } from "./app";
import { createSqlLockStore } from "./locks";

declare global {
  namespace Cloudflare {
    interface Env {
      readonly DB: D1Database;
      readonly STORAGE: DurableObjectNamespace<StorageObject>;
      /** The instance secret: signs sessions. At least 32 bytes. */
      readonly DAVLOOM_SECRET?: string;
      /** `off` turns off the check of new passwords against Have I Been Pwned. */
      readonly DAVLOOM_CHECK_LEAKED_PASSWORDS?: string;
      /** `off` turns off Better Auth's rate limit, for test harnesses only. */
      readonly DAVLOOM_AUTH_RATE_LIMIT?: string;
      /** When set, registering the owner or importing in its place has to name it. */
      readonly DAVLOOM_SETUP_TOKEN?: string;
      /** The public URL, e.g. https://davloom.example.workers.dev; else the request's origin. */
      readonly DAVLOOM_URL?: string;
    }
  }
}

const MIN_SECRET_BYTES = 32;

// The most objects one copy or move touches, its source and a destination it replaces (PRD §5).
// Each object costs internal subrequests on R2, at most 1,000 per invocation, and subrequests to
// the internet on S3, at most 50 per invocation on the Free plan. The request's own heads,
// listings, markers and batch deletes take about 17 more on S3, so 30 objects leave a margin.
const R2_MAX_ENTRIES = 400;
const S3_MAX_ENTRIES_ON_WORKERS = 30;

/**
 * Whether a binding is an R2 bucket. Duck typing is not enough: a service binding answers `in` for
 * every name, so the binding's own class is asked.
 */
const isR2Bucket = (value: unknown): value is R2Bucket =>
  Object.prototype.toString.call(value) === "[object R2Bucket]";

/** The instance on Workers: D1 for records, one Durable Object per storage backend. */
export const workersInstance = (origin: string): Instance => {
  const secret = env.DAVLOOM_SECRET ?? "";
  if (new TextEncoder().encode(secret).length < MIN_SECRET_BYTES) {
    throw new Error(`DAVLOOM_SECRET must be set to at least ${MIN_SECRET_BYTES} bytes`);
  }
  const db = createD1Database(env.DB);
  const r2Bindings = new Map(
    Object.entries(env).filter((entry): entry is [string, R2Bucket] => isR2Bucket(entry[1])),
  );
  const cipher = Effect.runPromise(makeCredentialCipher(Redacted.make(secret)));
  const unseal = async (backendId: string, sealed: string) =>
    await unsealWith(await cipher)(backendId, sealed);
  const repositories = createRepositories(db);
  const auth = createAuth({
    database: db,
    secret,
    baseURL: configuredOrigin(env.DAVLOOM_URL) ?? origin,
    checkLeakedPasswords: leakedPasswordCheckFrom(env.DAVLOOM_CHECK_LEAKED_PASSWORDS),
    rateLimit: rateLimitFrom(env.DAVLOOM_AUTH_RATE_LIMIT),
    // Cloudflare sets it to the client's address, replacing any value the client sent.
    clientIpHeaders: ["cf-connecting-ip"],
    passkeyOrigin: configuredOrigin(env.DAVLOOM_URL),
  });
  const operationLog = createOperationLog(db, d1Atomic(db));
  const layer = Layer.mergeAll(
    Layer.succeed(Records, repositories),
    Layer.succeed(Archive, createArchive(db, d1Atomic(db))),
    Layer.succeed(OperationLog, operationLog),
    Layer.succeed(InstanceSettings, createSettingsStore(db)),
    Layer.succeed(Identity, createIdentity(auth)),
    Layer.succeed(StorageOpener, {
      open: (backend) => {
        if (backend.kind === "durable-object") return durableObjectStorage(env.STORAGE, backend.id);
        if (backend.kind === "r2") {
          const checked = checkR2Config(backend.config);
          const bucket = checked.ok ? r2Bindings.get(checked.config.binding) : undefined;
          if (!checked.ok || !bucket) return null;
          // Counting the usage lists the whole bucket, so a recent count answers instead.
          return withUsageCache(
            createObjectStoreStorage({
              driver: createR2Driver({ bucket }),
              prefix: checked.config.prefix,
              properties: createSqlPropertyStore(db, backend.id),
              maxEntries: R2_MAX_ENTRIES,
            }),
            {
              key: JSON.stringify([
                "r2",
                backend.id,
                checked.config.binding,
                checked.config.prefix,
              ]),
            },
          );
        }
        if (backend.kind === "s3") {
          return openS3Backend(
            backend,
            unseal,
            createSqlPropertyStore(db, backend.id),
            S3_MAX_ENTRIES_ON_WORKERS,
          );
        }
        return null;
      },
    }),
    credentialCipherLayer(Redacted.make(secret)),

    Layer.succeed(InstanceConfig, {
      // R2 is offered only where the deployment has an R2 binding; enabling R2 needs a payment
      // method, so the default deployment has none.
      storageKinds: r2Bindings.size > 0 ? ["durable-object", "s3", "r2"] : ["durable-object", "s3"],
      setupToken: setupTokenFrom(env.DAVLOOM_SETUP_TOKEN),
      passkeys: configuredOrigin(env.DAVLOOM_URL) !== undefined,
    }),
  );
  return {
    layer,
    authHandler: (request) => auth.handler(request),
    locks: createSqlLockStore(repositories.locks),
    // Counts gather for 20 s, inside the 30 s that waitUntil keeps a Worker alive after its
    // response, so an isolate writes the operation log at most three times a minute.
    operations: createOperationRecorder({
      write: operationLog.add,
      schedule: (task) => waitUntil(task),
      delayMs: 20_000,
    }),
    about: (request) => ({
      runtime: "Cloudflare Workers",
      deployment: "Cloudflare",
      region: coloOf(request),
      database: "Cloudflare D1",
    }),
  };
};

/** The Cloudflare data center that served the request, such as NRT; null outside Cloudflare. */
const coloOf = (request: Request): string | null => {
  const cf: unknown = Reflect.get(request, "cf");
  const colo: unknown = typeof cf === "object" && cf !== null ? Reflect.get(cf, "colo") : null;
  return typeof colo === "string" ? colo : null;
};

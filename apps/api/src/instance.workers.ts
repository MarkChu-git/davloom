import { env } from "cloudflare:workers";
import { createAuth, createIdentity } from "@davloom/auth";
import {
  Archive,
  checkR2Config,
  credentialCipherLayer,
  Identity,
  InstanceConfig,
  makeCredentialCipher,
  Records,
  StorageOpener,
} from "@davloom/core";
import { createSqlPropertyStore } from "@davloom/database/properties";
import { createObjectStoreStorage } from "@davloom/storage/object-store";
import { openS3Backend, unsealWith } from "@davloom/storage/open-s3";
import { createR2Driver } from "@davloom/storage/r2";
import { createArchive } from "@davloom/database/archive";
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
      /** The token the first-run setup asks for. */
      readonly DAVLOOM_SETUP_TOKEN?: string;
      /** The public URL, e.g. https://davloom.example.workers.dev; else the request's origin. */
      readonly DAVLOOM_URL?: string;
    }
  }
}

const MIN_SECRET_BYTES = 32;

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
  const auth = createAuth({ database: db, secret, baseURL: env.DAVLOOM_URL ?? origin });
  const layer = Layer.mergeAll(
    Layer.succeed(Records, repositories),
    Layer.succeed(Archive, createArchive(db, d1Atomic(db))),
    Layer.succeed(Identity, createIdentity(auth)),
    Layer.succeed(StorageOpener, {
      open: (backend) => {
        if (backend.kind === "durable-object") return durableObjectStorage(env.STORAGE, backend.id);
        if (backend.kind === "r2") {
          const checked = checkR2Config(backend.config);
          const bucket = checked.ok ? r2Bindings.get(checked.config.binding) : undefined;
          if (!checked.ok || !bucket) return null;
          return createObjectStoreStorage({
            driver: createR2Driver({ bucket }),
            prefix: checked.config.prefix,
            properties: createSqlPropertyStore(db, backend.id),
          });
        }
        if (backend.kind === "s3") {
          return openS3Backend(backend, unseal, createSqlPropertyStore(db, backend.id));
        }
        return null;
      },
    }),
    credentialCipherLayer(Redacted.make(secret)),

    Layer.succeed(InstanceConfig, {
      setupToken: env.DAVLOOM_SETUP_TOKEN?.trim() ? env.DAVLOOM_SETUP_TOKEN.trim() : null,
      // R2 is offered only where the deployment has an R2 binding; enabling R2 needs a payment
      // method, so the default deployment has none.
      storageKinds: r2Bindings.size > 0 ? ["durable-object", "s3", "r2"] : ["durable-object", "s3"],
    }),
  );
  return {
    layer,
    authHandler: (request) => auth.handler(request),
    locks: createSqlLockStore(repositories.locks),
  };
};

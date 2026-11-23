import { env } from "cloudflare:workers";
import { createAuth, createIdentity } from "@davloom/auth";
import {
  credentialCipherLayer,
  Identity,
  InstanceConfig,
  makeCredentialCipher,
  Records,
  StorageOpener,
} from "@davloom/core";
import { createSqlPropertyStore } from "@davloom/database/properties";
import { openS3Backend, unsealWith } from "@davloom/storage/open-s3";
import { createD1Database } from "@davloom/database/d1";
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

/** The instance on Workers: D1 for records, one Durable Object per storage backend. */
export const workersInstance = (origin: string): Instance => {
  const secret = env.DAVLOOM_SECRET ?? "";
  if (new TextEncoder().encode(secret).length < MIN_SECRET_BYTES) {
    throw new Error(`DAVLOOM_SECRET must be set to at least ${MIN_SECRET_BYTES} bytes`);
  }
  const db = createD1Database(env.DB);
  const cipher = Effect.runPromise(makeCredentialCipher(Redacted.make(secret)));
  const unseal = async (backendId: string, sealed: string) =>
    await unsealWith(await cipher)(backendId, sealed);
  const repositories = createRepositories(db);
  const auth = createAuth({ database: db, secret, baseURL: env.DAVLOOM_URL ?? origin });
  const layer = Layer.mergeAll(
    Layer.succeed(Records, repositories),
    Layer.succeed(Identity, createIdentity(auth)),
    Layer.succeed(StorageOpener, {
      open: (backend) => {
        if (backend.kind === "durable-object") return durableObjectStorage(env.STORAGE, backend.id);
        if (backend.kind === "s3") {
          return openS3Backend(backend, unseal, createSqlPropertyStore(db, backend.id));
        }
        return null;
      },
    }),
    credentialCipherLayer(Redacted.make(secret)),

    Layer.succeed(InstanceConfig, {
      setupToken: env.DAVLOOM_SETUP_TOKEN?.trim() ? env.DAVLOOM_SETUP_TOKEN.trim() : null,
      storageKinds: ["durable-object", "s3"],
    }),
  );
  return {
    layer,
    authHandler: (request) => auth.handler(request),
    locks: createSqlLockStore(repositories.locks),
  };
};

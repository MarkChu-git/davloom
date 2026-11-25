import { Database } from "bun:sqlite";
import { createAuth, createIdentity } from "@davloom/auth";
import {
  Archive,
  AuditLog,
  createAuditCounter,
  createMemoryStorage,
  credentialCipherLayer,
  Identity,
  InstanceConfig,
  InstanceSettings,
  OperationLog,
  Records,
  StorageOpener,
  type StorageBackend,
} from "@davloom/core";
import { createArchive } from "@davloom/database/archive";
import {
  bunSqliteAtomic,
  createBunSqliteDatabase,
  migrateBunSqliteDatabase,
} from "@davloom/database/bun-sqlite";
import {
  createAuditLog,
  createOperationLog,
  createSettingsStore,
} from "@davloom/database/instance-data";
import { createRepositories } from "@davloom/database/repositories";
import { Layer, Redacted } from "effect";
import type { Instance } from "./app";
import { createSqlLockStore } from "./locks";

// An instance for tests outside this app, such as the contract tests of packages/client: Better
// Auth and the records on an in-memory Bun SQLite database, and memory storage behind every
// backend of the kind "memory", the one kind it offers.

/** An instance at `origin`, signed with `secret`, that keeps everything in memory. */
export const memoryInstance = (origin: string, secret: string): Instance => {
  const db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  const repositories = createRepositories(db);
  const auditLog = createAuditLog(db, bunSqliteAtomic(db));
  const auth = createAuth({ database: db, secret, baseURL: origin, checkLeakedPasswords: false });
  const storages = new Map<string, StorageBackend>();
  return {
    layer: Layer.mergeAll(
      Layer.succeed(Records, repositories),
      Layer.succeed(Archive, createArchive(db, bunSqliteAtomic(db))),
      Layer.succeed(Identity, createIdentity(auth)),
      Layer.succeed(StorageOpener, {
        open: (backend) => {
          if (backend.kind !== "memory") return null;
          const storage = storages.get(backend.id) ?? createMemoryStorage();
          storages.set(backend.id, storage);
          return storage;
        },
      }),
      Layer.succeed(InstanceConfig, { storageKinds: ["memory"], setupToken: null }),
      credentialCipherLayer(Redacted.make(secret)),
      Layer.succeed(OperationLog, createOperationLog(db, bunSqliteAtomic(db))),
      Layer.succeed(InstanceSettings, createSettingsStore(db)),
      Layer.succeed(AuditLog, auditLog),
    ),
    authHandler: (request) => auth.handler(request),
    locks: createSqlLockStore(repositories.locks),
    refusedCredentials: createAuditCounter({
      write: auditLog.add,
      schedule: () => undefined,
      wait: () => new Promise<void>(() => undefined),
    }),
  };
};

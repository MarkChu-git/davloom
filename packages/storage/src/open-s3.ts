import {
  checkS3Config,
  type BackendRecord,
  type CredentialsError,
  type PropertyStore,
  type StorageBackend,
} from "@davloom/core";
import { Effect, Redacted } from "effect";
import { createObjectStoreStorage } from "./object-store";
import { createS3Client, createS3Driver } from "./s3";

/**
 * Opens an S3-compatible backend from its stored record. Its secret key is unsealed on the first
 * call, so opening costs nothing until a request reaches the backend; a record whose secret does
 * not open or whose configuration is invalid answers every call as unavailable.
 */
export const openS3Backend = (
  record: BackendRecord,
  unseal: (backendId: string, sealed: string) => Promise<string | null>,
  properties: PropertyStore,
): StorageBackend => {
  let opened: Promise<StorageBackend | null> | undefined;
  const open = () => {
    opened ??= (async () => {
      const checked = checkS3Config(record.config);
      if (!checked.ok || !record.secretKey) return null;
      const secretAccessKey = await unseal(record.id, record.secretKey);
      if (secretAccessKey === null) return null;
      const client = createS3Client({ ...checked.config, secretAccessKey });
      return createObjectStoreStorage({
        driver: createS3Driver({ client, bucket: checked.config.bucket }),
        prefix: checked.config.prefix,
        properties,
      });
    })();
    return opened;
  };
  const unavailable = { ok: false, failure: "unavailable" } as const;
  /** Runs `call` on the opened backend, or answers unavailable and drops an upload's body. */
  const via = async <T>(
    call: (backend: StorageBackend) => Promise<T>,
    body?: ReadableStream<Uint8Array> | null,
  ): Promise<T | typeof unavailable> => {
    const backend = await open();
    if (!backend) {
      await body?.cancel();
      return unavailable;
    }
    return await call(backend);
  };
  return {
    stat: (path) => via((b) => b.stat(path)),
    list: (path) => via((b) => b.list(path)),
    read: (path, range) => via((b) => b.read(path, range)),
    write: (path, body, options) => via((b) => b.write(path, body, options), body),
    createCollection: (path) => via((b) => b.createCollection(path)),
    remove: (path) => via((b) => b.remove(path)),
    copy: (from, to, options) => via((b) => b.copy(from, to, options)),
    move: (from, to, options) => via((b) => b.move(from, to, options)),
    properties: (paths) => via((b) => b.properties(paths)),
    patchProperties: (path, set, remove) => via((b) => b.patchProperties(path, set, remove)),
    usage: () => via((b) => b.usage()),
  };
};

/** Unseals a backend's secret key with a credential cipher; null when it does not open. */
export const unsealWith =
  (cipher: {
    readonly open: (
      backendId: string,
      sealed: string,
    ) => Effect.Effect<Redacted.Redacted, CredentialsError>;
  }) =>
  async (backendId: string, sealed: string): Promise<string | null> => {
    const exit = await Effect.runPromiseExit(cipher.open(backendId, sealed));
    return exit._tag === "Success" ? Redacted.value(exit.value) : null;
  };

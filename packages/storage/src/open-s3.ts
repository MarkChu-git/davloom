import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  checkS3Config,
  type BackendCheck,
  type BackendRecord,
  type CredentialsError,
  type PropertyStore,
  type StorageBackend,
} from "@davloom/core";
import { Effect, Redacted } from "effect";
import { createObjectStoreStorage } from "./object-store";
import { createS3Client, createS3Driver, describeS3Error } from "./s3";

/**
 * Opens an S3-compatible backend from its stored record. Its secret key is unsealed on the first
 * call, so opening costs nothing until a request reaches the backend; a record whose secret does
 * not open or whose configuration is invalid answers every call as unavailable.
 */
export const openS3Backend = (
  record: BackendRecord,
  unseal: (backendId: string, sealed: string) => Promise<string | null>,
  properties: PropertyStore,
  /** The most objects one copy or move may touch; see ObjectStoreOptions.maxEntries. */
  maxEntries?: number,
): StorageBackend => {
  type Opened =
    | { readonly backend: StorageBackend; readonly check: () => Promise<BackendCheck> }
    | { readonly backend: null; readonly reason: string };
  let opening: Promise<Opened> | undefined;
  const openWithReason = () => {
    opening ??= (async (): Promise<Opened> => {
      const checked = checkS3Config(record.config);
      if (!checked.ok) return { backend: null, reason: `The ${checked.field} is not valid` };
      if (!record.secretKey) return { backend: null, reason: "No secret key is stored" };
      const secretAccessKey = await unseal(record.id, record.secretKey);
      if (secretAccessKey === null)
        return { backend: null, reason: "The stored secret key does not open" };
      const client = createS3Client({ ...checked.config, secretAccessKey });
      const { bucket, prefix } = checked.config;
      return {
        backend: createObjectStoreStorage({
          driver: createS3Driver({ client, bucket }),
          prefix,
          properties,
          ...(maxEntries === undefined ? {} : { maxEntries }),
        }),
        check: async () => {
          try {
            await client.send(
              new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }),
            );
            return { ok: true };
          } catch (error) {
            return { ok: false, reason: describeS3Error(error) };
          }
        },
      };
    })();
    return opening;
  };
  const open = async () => (await openWithReason()).backend;
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
    // The properties live in the instance database, so they go even when the store does not answer.
    release: () => properties.removeTree([]),
    check: async () => {
      const opened = await openWithReason();
      return opened.backend ? await opened.check() : { ok: false, reason: opened.reason };
    },
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

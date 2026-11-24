import { Data, Effect, Redacted } from "effect";
import { checkR2Config, checkS3Config } from "./backend-config";
import { CredentialCipher } from "./credentials";
import {
  InvalidInput,
  NameTaken,
  NotFound,
  Records,
  StorageOpener,
  type BackendRecord,
} from "./instance";
import type { BackendCheck, StorageFailure } from "./storage";

// Changing a backend after it was added, and asking each backend whether it answers.

const isUnique = (error: unknown) => {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (/UNIQUE constraint failed/i.test(current.message)) return true;
  }
  return false;
};

const findBackend = (id: string) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const backend = (yield* Effect.promise(() => records.backends.list())).find(
      (record) => record.id === id,
    );
    return backend ?? (yield* Effect.fail(new NotFound()));
  });

/**
 * Renames a backend and, for S3-compatible storage and R2, changes its configuration. An empty or
 * absent secret key keeps the one stored, so the Dashboard never needs to know it.
 */
export const updateBackend = (
  id: string,
  input: { name: string; config?: unknown; secretKey?: string },
) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const backend = yield* findBackend(id);
    const name = input.name.trim();
    if (name === "" || name.length > 64)
      return yield* Effect.fail(new InvalidInput({ field: "name" }));
    let config: unknown = backend.config;
    let secretKey = backend.secretKey;
    if (backend.kind === "s3") {
      const checked = checkS3Config(input.config ?? backend.config);
      if (!checked.ok) return yield* Effect.fail(new InvalidInput({ field: checked.field }));
      config = checked.config;
      const secret = input.secretKey ?? "";
      if (secret.length > 256) return yield* Effect.fail(new InvalidInput({ field: "secretKey" }));
      if (secret !== "") {
        const cipher = yield* CredentialCipher;
        secretKey = yield* cipher.seal(id, Redacted.make(secret));
      } else if (secretKey === null) {
        return yield* Effect.fail(new InvalidInput({ field: "secretKey" }));
      }
    } else if (backend.kind === "r2") {
      const checked = checkR2Config(input.config ?? backend.config);
      if (!checked.ok) return yield* Effect.fail(new InvalidInput({ field: checked.field }));
      config = checked.config;
    }
    const updated = yield* Effect.tryPromise({
      try: () => records.backends.update(id, { name, config, secretKey }),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) => (isUnique(error) ? Effect.fail(new NameTaken()) : Effect.die(error))),
    );
    if (!updated) return yield* Effect.fail(new NotFound());
    return { id };
  });

/** A Mount publishes the backend, so removing it would leave the Mount pointing nowhere. */
export class BackendInUse extends Data.TaggedError("BackendInUse")<{}> {}
/** A Durable Objects backend that still holds files: removing it would lose them. */
export class BackendNotEmpty extends Data.TaggedError("BackendNotEmpty")<{}> {}
/** The backend did not answer, so what it holds could not be released. */
export class BackendUnavailable extends Data.TaggedError("BackendUnavailable")<{}> {}

/**
 * Removes a backend that no Mount uses. A Durable Objects backend must be empty, and its storage
 * is deleted with it. An S3-compatible or R2 backend keeps every object in its bucket; only the
 * dead properties Davloom kept for it go. `filesKept` says which happened.
 */
export const removeBackend = (id: string) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const opener = yield* StorageOpener;
    const backend = yield* findBackend(id);
    const mounts = yield* Effect.promise(() => records.mounts.list());
    if (mounts.some((mount) => mount.backendId === id))
      return yield* Effect.fail(new BackendInUse());
    const storage = opener.open(backend);
    const release = storage?.release?.bind(storage);
    const released = release ? yield* Effect.promise(() => release()) : null;
    if (released && !released.ok) {
      return yield* Effect.fail(
        released.failure === "exists" ? new BackendNotEmpty() : new BackendUnavailable(),
      );
    }
    if (!(yield* Effect.promise(() => records.backends.remove(id))))
      return yield* Effect.fail(new NotFound());
    return { id, filesKept: backend.kind !== "durable-object" };
  });

/** What a check of a backend found: whether it answered, how fast, and why not. */
export interface BackendCheckView {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  /** Milliseconds the backend took to answer; null when it did not. */
  readonly latencyMs: number | null;
  /** Why the backend did not answer; null when it did. */
  readonly reason: string | null;
  readonly checkedAt: string;
}

const FAILURE_REASONS: Partial<Record<StorageFailure, string>> = {
  unavailable: "No answer from the backend",
  "insufficient-storage": "The backend is full",
};

const checkOne = (backend: BackendRecord, now: () => number) =>
  Effect.gen(function* () {
    const opener = yield* StorageOpener;
    const storage = opener.open(backend);
    const started = now();
    const result: BackendCheck = storage
      ? yield* Effect.promise(async (): Promise<BackendCheck> => {
          if (storage.check) return await storage.check();
          const root = await storage.stat([]);
          return root.ok
            ? { ok: true }
            : { ok: false, reason: FAILURE_REASONS[root.failure] ?? root.failure };
        })
      : { ok: false, reason: `This server cannot open ${backend.kind} backends` };
    const finished = now();
    return {
      id: backend.id,
      name: backend.name,
      available: result.ok,
      latencyMs: result.ok ? Math.max(0, Math.round(finished - started)) : null,
      reason: result.ok ? null : result.reason,
      checkedAt: new Date(finished).toISOString(),
    } satisfies BackendCheckView;
  });

/** Asks one backend whether it answers. */
export const verifyBackend = (id: string, now: () => number = Date.now) =>
  Effect.flatMap(findBackend(id), (backend) => checkOne(backend, now));

/** Asks every backend whether it answers, all at once. */
export const checkBackends = (now: () => number = Date.now) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const backends = yield* Effect.promise(() => records.backends.list());
    return yield* Effect.forEach(backends, (backend) => checkOne(backend, now), {
      concurrency: "unbounded",
    });
  });

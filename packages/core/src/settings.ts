import { Context, Effect } from "effect";
import { InvalidInput, Records } from "./instance";

// Instance settings the administrator changes on the Dashboard, kept in the instance database by
// key. Each value is JSON.

/** The Port to the stored settings. */
export class InstanceSettings extends Context.Service<
  InstanceSettings,
  {
    /** The stored value, or undefined when the setting was never saved. */
    readonly get: (key: string) => Promise<unknown>;
    readonly set: (key: string, value: unknown) => Promise<void>;
  }
>()("@davloom/core/InstanceSettings") {}

const DEFAULT_BACKEND = "storage.defaultBackendId";

export interface StorageSettings {
  /** The backend a new Mount starts with; the first backend until one is chosen, null without any. */
  readonly defaultBackendId: string | null;
}

/** The storage settings. A chosen backend that no longer exists gives way to the first one. */
export const storageSettings = Effect.gen(function* () {
  const records = yield* Records;
  const settings = yield* InstanceSettings;
  const [backends, stored] = yield* Effect.promise(() =>
    Promise.all([records.backends.list(), settings.get(DEFAULT_BACKEND)]),
  );
  const chosen = backends.find((backend) => backend.id === stored);
  return { defaultBackendId: chosen?.id ?? backends[0]?.id ?? null } satisfies StorageSettings;
});

export const saveStorageSettings = (input: { defaultBackendId: unknown }) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const settings = yield* InstanceSettings;
    const backends = yield* Effect.promise(() => records.backends.list());
    const id = input.defaultBackendId;
    if (typeof id !== "string" || !backends.some((backend) => backend.id === id)) {
      return yield* Effect.fail(new InvalidInput({ field: "defaultBackendId" }));
    }
    yield* Effect.promise(() => settings.set(DEFAULT_BACKEND, id));
    return { defaultBackendId: id } satisfies StorageSettings;
  });

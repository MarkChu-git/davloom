import { ok, type StorageBackend, type StorageResult, type Usage } from "@davloom/core";

// An object store knows its usage only by listing every key under the backend's prefix, which
// costs a request per 1,000 keys, and the Dashboard asks for it on every visit. This wrapper keeps
// the last listing's usage in the isolate and answers from it, with the time it was measured, for
// a few minutes; for at most a minute once Davloom itself changed the backend. Changes made to the
// bucket by other tools show once the usage is listed again.

/** How long a listing's usage stands while nothing changed it through Davloom. */
export const USAGE_MAX_AGE_MS = 5 * 60 * 1000;

/** How long a listing's usage stands once a write, removal, copy or move went through Davloom. */
export const USAGE_MAX_AGE_AFTER_CHANGE_MS = 60 * 1000;

export interface CachedUsage {
  /** Counts the changes made through any wrapper of this backend in the isolate. */
  version: number;
  measured: { readonly usage: Usage; readonly at: number; readonly version: number } | undefined;
  pending: Promise<StorageResult<Usage>> | undefined;
}

export interface UsageCacheOptions {
  /** Names the backend and the settings it lists by, so changed settings list again. */
  readonly key: string;
  readonly maxAge?: number;
  readonly maxAgeAfterChange?: number;
  readonly now?: () => number;
  /** Where the usage is kept; one map for the isolate unless a test passes its own. */
  readonly store?: Map<string, CachedUsage>;
}

const ISOLATE = new Map<string, CachedUsage>();

/** A fresh store, for tests. */
export const createUsageStore = (): Map<string, CachedUsage> => new Map();

/** `backend` with its usage answered from the last listing while that stands. */
export const withUsageCache = (
  backend: StorageBackend,
  options: UsageCacheOptions,
): StorageBackend => {
  const store = options.store ?? ISOLATE;
  const now = options.now ?? Date.now;
  const maxAge = options.maxAge ?? USAGE_MAX_AGE_MS;
  const maxAgeAfterChange = options.maxAgeAfterChange ?? USAGE_MAX_AGE_AFTER_CHANGE_MS;
  const cached = (): CachedUsage => {
    let entry = store.get(options.key);
    if (!entry) {
      entry = { version: 0, measured: undefined, pending: undefined };
      store.set(options.key, entry);
    }
    return entry;
  };
  /** Runs a call that may change the tree, and counts it as a change once it ends. */
  const changing = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } finally {
      cached().version += 1;
    }
  };
  const usage = async (): Promise<StorageResult<Usage>> => {
    const entry = cached();
    const { measured } = entry;
    if (measured) {
      const limit = measured.version === entry.version ? maxAge : maxAgeAfterChange;
      if (now() - measured.at < limit) return ok({ ...measured.usage, measuredAt: measured.at });
    }
    if (entry.pending) return await entry.pending;
    const at = now();
    const version = entry.version;
    const pending = (async (): Promise<StorageResult<Usage>> => {
      const result = await backend.usage();
      if (!result.ok) return result;
      const counted: Usage = {
        files: result.value.files,
        collections: result.value.collections,
        bytes: result.value.bytes,
      };
      entry.measured = { usage: counted, at, version };
      return ok({ ...counted, measuredAt: at });
    })();
    entry.pending = pending;
    try {
      return await pending;
    } finally {
      entry.pending = undefined;
    }
  };
  return {
    ...backend,
    write: (path, body, writeOptions) => changing(() => backend.write(path, body, writeOptions)),
    createCollection: (path) => changing(() => backend.createCollection(path)),
    remove: (path) => changing(() => backend.remove(path)),
    copy: (from, to, copyOptions) => changing(() => backend.copy(from, to, copyOptions)),
    move: (from, to, moveOptions) => changing(() => backend.move(from, to, moveOptions)),
    usage,
    release: async () => {
      store.delete(options.key);
      return await (backend.release?.() ?? Promise.resolve(ok(null)));
    },
  };
};

import { fail, ok, type ByteRange, type StorageFailure, type StorageResult } from "@davloom/core";
import type { ListOptions, ListPage, ObjectInfo, ObjectStoreDriver } from "../object-store";

// An object store held in memory, with the listing rules of S3: keys in UTF-8 byte order, a
// one-level listing that rolls keys up to their first `/` after the prefix into common prefixes,
// and pages that resume after the last key or common prefix they gave. Tests put keys in it
// directly, as another tool would, and can make any call fail.

export interface StoredObject {
  readonly bytes: Uint8Array;
  readonly etag: string;
  readonly modified: number;
  readonly created: number | undefined;
  readonly contentType: string | null;
}

export type DriverCall = "head" | "get" | "put" | "list" | "delete" | "copy";

export interface MemoryDriverOptions {
  /** Keys and common prefixes per page; S3 gives 1,000. */
  readonly pageSize?: number;
  readonly now?: () => number;
}

export interface MemoryDriver extends ObjectStoreDriver {
  readonly objects: Map<string, StoredObject>;
  /** Stores an object as another tool would. */
  seed(key: string, text?: string): void;
  /** The keys held, in the store's order. */
  keys(): string[];
  /** Makes calls fail: return a failure for a call to fail it, or null to let it run. */
  failWhen(rule: ((call: DriverCall, key: string) => StorageFailure | null) | null): void;
  /**
   * Refuses keys as a store with rules of its own does: every call about a key, or a listing of a
   * prefix, that `rule` holds for fails with `name-refused`, as does a copy onto such a key.
   */
  refuseKeys(rule: ((key: string) => boolean) | null): void;
  /** The calls made, for counting requests. */
  readonly calls: { call: DriverCall; key: string }[];
}

const encoder = new TextEncoder();

/** Compares keys by their UTF-8 bytes, as S3 orders them. */
export const compareKeys = (a: string, b: string): number => {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  for (let index = 0; index < Math.min(x.length, y.length); index += 1) {
    const difference = (x[index] ?? 0) - (y[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return x.length - y.length;
};

export const createMemoryDriver = (options: MemoryDriverOptions = {}): MemoryDriver => {
  const pageSize = options.pageSize ?? 1000;
  const now = options.now ?? Date.now;
  const objects = new Map<string, StoredObject>();
  const calls: { call: DriverCall; key: string }[] = [];
  let rule: ((call: DriverCall, key: string) => StorageFailure | null) | null = null;
  let keyRule: ((key: string) => boolean) | null = null;
  const refusesKey = (key: string) => keyRule?.(key) ?? false;
  let counter = 0;
  const nextTag = () => `e${(counter += 1).toString(36)}`;
  const keys = () => [...objects.keys()].toSorted(compareKeys);
  const refused = (call: DriverCall, key: string): StorageFailure | null => {
    calls.push({ call, key });
    if (refusesKey(key)) return "name-refused";
    return rule ? rule(call, key) : null;
  };
  const infoOf = (key: string, stored: StoredObject): ObjectInfo => ({
    key,
    size: stored.bytes.length,
    etag: stored.etag,
    modified: stored.modified,
    created: stored.created,
    contentType: stored.contentType,
  });
  const store = (
    key: string,
    bytes: Uint8Array,
    created: number | undefined,
    type: string | null,
  ) => objects.set(key, { bytes, etag: nextTag(), modified: now(), created, contentType: type });

  const list = (prefix: string, { recursive, cursor, limit }: ListOptions): ListPage => {
    const found: ObjectInfo[] = [];
    const prefixes: string[] = [];
    const max = Math.min(limit ?? pageSize, pageSize);
    let last: string | null = null;
    for (const key of keys()) {
      if (!key.startsWith(prefix)) continue;
      if (cursor && compareKeys(key, cursor) <= 0) continue;
      const slash = recursive ? -1 : key.indexOf("/", prefix.length);
      const common = slash === -1 ? null : key.slice(0, slash + 1);
      // Keys under a common prefix that an earlier page gave are part of it.
      if (common !== null && cursor && cursor === common) continue;
      if (common !== null && prefixes.at(-1) === common) continue;
      if (found.length + prefixes.length === max) return { objects: found, prefixes, cursor: last };
      const stored = objects.get(key);
      if (common !== null) {
        prefixes.push(common);
        last = common;
      } else if (stored) {
        found.push(infoOf(key, stored));
        last = key;
      }
    }
    return { objects: found, prefixes, cursor: null };
  };

  return {
    objects,
    calls,
    keys,
    seed: (key, text = "") => {
      store(key, encoder.encode(text), undefined, null);
    },
    failWhen: (next) => {
      rule = next;
    },
    refuseKeys: (next) => {
      keyRule = next;
    },
    head: (key) => {
      const failure = refused("head", key);
      if (failure) return Promise.resolve(fail(failure));
      const stored = objects.get(key);
      return Promise.resolve(ok(stored ? infoOf(key, stored) : null));
    },
    get: (key, range?: ByteRange) => {
      const failure = refused("get", key);
      if (failure) return Promise.resolve(fail(failure));
      const stored = objects.get(key);
      if (!stored) return Promise.resolve(ok(null));
      const bytes = range ? stored.bytes.slice(range.start, range.stop) : stored.bytes;
      return Promise.resolve(
        ok({ info: infoOf(key, stored), body: new Blob([bytes.slice()]).stream() }),
      );
    },
    put: async (key, body, { length, contentType, created, ifNoneMatch }) => {
      const failure = refused("put", key) ?? (ifNoneMatch && objects.has(key) ? "exists" : null);
      if (failure) {
        await body?.cancel();
        return fail(failure);
      }
      let bytes: Uint8Array;
      try {
        bytes = body ? new Uint8Array(await new Response(body).arrayBuffer()) : new Uint8Array();
      } catch {
        return fail("unavailable");
      }
      if (length !== undefined && bytes.length !== length) return fail("unavailable");
      // Checked again with the store in one step, as S3 checks a conditional put: another put may
      // have stored the key while this body was read.
      if (ifNoneMatch && objects.has(key)) return fail("exists");
      store(key, bytes, created, contentType ?? null);
      return ok({ etag: objects.get(key)?.etag ?? "" });
    },
    list: (prefix, listOptions): Promise<StorageResult<ListPage>> => {
      const failure = refused("list", prefix);
      return Promise.resolve(failure ? fail(failure) : ok(list(prefix, listOptions)));
    },
    delete: (doomed) => {
      for (const key of doomed) {
        const failure = refused("delete", key);
        if (failure) return Promise.resolve(fail(failure));
      }
      for (const key of doomed) objects.delete(key);
      return Promise.resolve(ok(null));
    },
    copy: (from, to) => {
      const failure = refused("copy", from) ?? (refusesKey(to) ? "name-refused" : null);
      if (failure) return Promise.resolve(fail(failure));
      const stored = objects.get(from);
      if (!stored) return Promise.resolve(ok(false));
      store(to, stored.bytes, stored.created, stored.contentType);
      return Promise.resolve(ok(true));
    },
  };
};

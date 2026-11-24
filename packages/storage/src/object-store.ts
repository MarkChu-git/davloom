import {
  fail,
  failureOf,
  isWithin,
  ok,
  parentOf,
  pathKey,
  type ByteRange,
  type DeadProperty,
  type Entry,
  type Path,
  type PropertyStore,
  type StorageBackend,
  type StorageFailure,
  type StorageResult,
} from "@davloom/core";
import {
  decideCopy,
  decideMkcol,
  decideMove,
  decideRemove,
  decideWrite,
  isValidName,
  isValidPath,
  resumeMove,
  withinLimit,
  type Node,
} from "@davloom/laws";

// One adapter for object stores such as S3-compatible storage and R2 (Decision 6 of
// add-phase-1-core). A driver supplies a few calls by key, and the adapter presents them as a tree:
//
// - The file at a path is the key `<prefix><names joined by "/">`, the marker of the collection
//   at a path is that key followed by `/`, and the root is the prefix itself, with no marker.
// - Every part of a key that ends at a `/` is a collection, with a marker or without one, so the
//   objects that other tools put in the bucket appear as a tree.
// - A key whose parts are not valid names forms no path and is hidden, and a file whose key is a
//   collection's key without its `/` is hidden by the collection. Removing, copying or moving a
//   collection that holds hidden objects fails with "hidden-objects" and changes nothing.
//
// The adapter gathers its facts with head requests and listings and decides with the proven
// decisions of @davloom/laws, as every adapter does. Nothing that spans two keys is atomic in an
// object store: a move copies everything and only then removes the source, so a failure part-way
// leaves entries in both places but never in neither. Dead properties live in a Property Store,
// since an object store keeps none for collections and cannot change an object's metadata.

/** S3's largest single upload, 5 GiB, less 5 MiB of headroom (Decision 4). */
export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3 - 5 * 1024 ** 2;

/** Keys per batch delete, the most S3 and R2 take in one request. */
export const DELETE_BATCH = 1000;

/** Copies in flight at once while copying or moving a collection. */
const PARALLEL_COPIES = 8;

/** Object stores keep no times or tags for collections; every collection reports these. */
export const COLLECTION_ETAG = "collection";

export interface ObjectInfo {
  readonly key: string;
  /** The object's whole size, also when it was read by range. */
  readonly size: number;
  /** The store's ETag, without quotes. */
  readonly etag: string;
  /** Milliseconds since the epoch. */
  readonly modified: number;
  /** The creation time the adapter stored with the object; heads and reads only. */
  readonly created?: number | undefined;
  /** Heads and reads only. */
  readonly contentType?: string | null | undefined;
}

export interface ObjectRead {
  readonly info: ObjectInfo;
  /** The object's bytes, or the range's. */
  readonly body: ReadableStream<Uint8Array>;
}

export interface ListPage {
  readonly objects: readonly ObjectInfo[];
  /** For a one-level listing: each common prefix, ending at `/`. */
  readonly prefixes: readonly string[];
  /** Where the next page starts, or null after the last. */
  readonly cursor: string | null;
}

export interface ListOptions {
  /** Every key under the prefix, rather than one level with `/` as the delimiter. */
  readonly recursive: boolean;
  readonly cursor?: string | null | undefined;
  /** The most keys and common prefixes the page holds. */
  readonly limit?: number | undefined;
}

export interface PutOptions {
  /** The body's length when it is known; the driver may then stream it in one request. */
  readonly length?: number | undefined;
  readonly contentType?: string | null | undefined;
  /** The creation time to keep with the object. */
  readonly created: number;
  /** Store only if no object has the key: fail with `exists` otherwise (S3's If-None-Match: *). */
  readonly ifNoneMatch?: boolean | undefined;
}

/**
 * The calls an object store supplies. Each returns a result instead of throwing, with the store's
 * own errors already turned into Port failures.
 */
export interface ObjectStoreDriver {
  /** The object at `key`, or null when there is none. */
  head(key: string): Promise<StorageResult<ObjectInfo | null>>;
  /** The object at `key`, whole or the bytes of a non-empty range, or null when there is none. */
  get(key: string, range?: ByteRange): Promise<StorageResult<ObjectRead | null>>;
  /** Stores an object, replacing any at `key`. A body that fails leaves the old object. */
  put(
    key: string,
    body: ReadableStream<Uint8Array> | null,
    options: PutOptions,
  ): Promise<StorageResult<{ readonly etag: string }>>;
  /** One page of the keys under `prefix`, in the store's order of keys. */
  list(prefix: string, options: ListOptions): Promise<StorageResult<ListPage>>;
  /** Deletes up to DELETE_BATCH keys; keys that do not exist are not an error. */
  delete(keys: readonly string[]): Promise<StorageResult<null>>;
  /** Copies an object with its metadata; false when the source does not exist. */
  copy(from: string, to: string): Promise<StorageResult<boolean>>;
}

export interface ObjectStoreOptions {
  readonly driver: ObjectStoreDriver;
  /** The key prefix of the backend: empty, or ending at `/`. */
  readonly prefix: string;
  readonly properties: PropertyStore;
  readonly now?: () => number;
  /** The largest file; MAX_UPLOAD_BYTES unless a test asks for less. */
  readonly maxFileSize?: number;
  /**
   * The most objects one copy or move may touch (PRD §5): 400 for R2 and about 40 for S3 on
   * Workers, whose requests count toward an invocation's subrequests. Absent for no limit.
   */
  readonly maxEntries?: number;
}

// A move of a collection records its destination before it moves the source's properties and
// removes the source, and drops the record once the source is gone. A move that stopped part-way
// leaves the record beside a source that is partly gone and a destination that holds everything.
// A client's retry of that move, with Overwrite: T as clients send by default, must not replace the
// destination, which holds what was already removed from the source: it finds the record and
// resumes instead (resumeMove, PRD §5 recovery of multi-object operations). The record lives in the
// Property Store under a path that begins with `..`, which no entry's path does, so no client can
// read or set it and no copy or move of the tree carries it along.

const JOURNAL = "{urn:davloom:internal}move-to";

/** Where the record of a move of the collection at `from` lives. */
const journalPath = (from: Path): Path => ["..", "davloom-moves", ...from];

const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The record of a move of a collection to `to`. */
const journalOf = (to: Path): DeadProperty => ({
  name: JOURNAL,
  xml: `<move-to xmlns="urn:davloom:internal">${escapeXml(pathKey(to))}</move-to>`,
});

// --- Keys --------------------------------------------------------------------------------------

/** The key of the file at `path`. */
export const fileKey = (prefix: string, path: Path): string => `${prefix}${path.join("/")}`;

/** The key of the marker of the collection at `path`; for the root, the prefix itself. */
export const markerKey = (prefix: string, path: Path): string =>
  path.length === 0 ? prefix : `${prefix}${path.join("/")}/`;

export interface KeyPath {
  readonly path: Path;
  readonly kind: "file" | "collection";
}

/**
 * The path a key under `prefix` forms, or null when it forms none: when it lies outside the
 * prefix, is the root's own key, or has a part that is not a valid name.
 */
export const pathOfKey = (prefix: string, key: string): KeyPath | null => {
  if (!key.startsWith(prefix) || key === prefix) return null;
  const rest = key.slice(prefix.length);
  const marker = rest.endsWith("/");
  const path = (marker ? rest.slice(0, -1) : rest).split("/");
  if (!path.every((name) => isValidName(name)) || !isValidPath(path)) return null;
  return { path, kind: marker ? "collection" : "file" };
};

const byName = (a: Entry, b: Entry) => {
  const x = a.path.at(-1) ?? "";
  const y = b.path.at(-1) ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
};

const collectionEntry = (path: Path): Entry => ({
  path,
  kind: "collection",
  size: 0,
  etag: COLLECTION_ETAG,
  modified: 0,
  created: 0,
  contentType: null,
});

const fileEntry = (path: Path, info: ObjectInfo): Entry => ({
  path,
  kind: "file",
  size: info.size,
  etag: info.etag,
  modified: info.modified,
  created: info.created ?? info.modified,
  contentType: info.contentType ?? null,
});

/** Whether a name directly inside `path` forms a valid path. */
const isVisibleChild = (path: Path, name: string) =>
  isValidName(name) && isValidPath([...path, name]);

/**
 * The entries of the collection at `path` from a one-level listing under its marker key: each
 * common prefix with a valid name is a collection, and each other key with a valid name is a file,
 * unless a collection has its name. The collection's own marker is skipped.
 */
export const readLevel = (
  prefix: string,
  path: Path,
  objects: readonly ObjectInfo[],
  prefixes: readonly string[],
): Entry[] => {
  const base = markerKey(prefix, path);
  const collections = new Map<string, Entry>();
  for (const common of prefixes) {
    const name = common.slice(base.length, -1);
    if (common.startsWith(base) && isVisibleChild(path, name)) {
      collections.set(name, collectionEntry([...path, name]));
    }
  }
  const files: Entry[] = [];
  for (const object of objects) {
    const name = object.key.slice(base.length);
    if (!object.key.startsWith(base) || name.includes("/") || collections.has(name)) continue;
    if (isVisibleChild(path, name)) files.push(fileEntry([...path, name], object));
  }
  return [...collections.values(), ...files].toSorted(byName);
};

export interface Tree {
  /** The visible files under the collection, with their paths. */
  readonly files: readonly { readonly path: Path; readonly info: ObjectInfo }[];
  /** The collections under it, with a marker or without one. */
  readonly collections: readonly Path[];
  /** Whether a key under it forms no path, or a file is hidden by a collection of its name. */
  readonly hidden: boolean;
}

/** The tree under the collection at `path`, from a recursive listing under its marker key. */
export const readTree = (prefix: string, path: Path, objects: readonly ObjectInfo[]): Tree => {
  const base = markerKey(prefix, path);
  const files = new Map<string, { path: Path; info: ObjectInfo }>();
  const collections = new Map<string, Path>();
  let hidden = false;
  for (const object of objects) {
    if (!object.key.startsWith(base) || object.key === base) continue;
    const rest = object.key.slice(base.length);
    const marker = rest.endsWith("/");
    const names = (marker ? rest.slice(0, -1) : rest).split("/");
    const current: string[] = [...path];
    let valid = true;
    for (const [index, name] of names.entries()) {
      current.push(name);
      if (!isValidName(name) || !isValidPath(current)) {
        valid = false;
        break;
      }
      if (index < names.length - 1 || marker) collections.set(pathKey(current), [...current]);
    }
    if (!valid) hidden = true;
    else if (!marker) files.set(pathKey(current), { path: current, info: object });
  }
  for (const key of files.keys()) {
    if (collections.has(key)) {
      files.delete(key);
      hidden = true;
    }
  }
  return { files: [...files.values()], collections: [...collections.values()], hidden };
};

// --- Streams -----------------------------------------------------------------------------------

/** A stream of `body` that fails when it delivers more or fewer bytes than `size`, if stated. */
const countBytes = (
  body: ReadableStream<Uint8Array> | null,
  size: number | undefined,
  limit = MAX_UPLOAD_BYTES,
) => {
  const state = { failed: false, cancelled: false, tooLarge: false, bytes: 0 };
  const reader = body?.getReader();
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = reader ? await reader.read() : { done: true as const };
          if (next.done) {
            if (size !== undefined && state.bytes !== size) throw new Error("the body ended short");
            controller.close();
            return;
          }
          state.bytes += next.value.byteLength;
          // A body of unknown length still stops at what one object may hold and later be copied.
          if (state.bytes > limit) {
            state.tooLarge = true;
            await reader?.cancel();
            throw new Error("the body is too large");
          }
          if (size !== undefined && state.bytes > size) {
            await reader?.cancel();
            throw new Error("the body is longer than stated");
          }
          controller.enqueue(next.value);
        } catch (error) {
          // A driver that gave up on the body cancelled it; that is the driver's failure.
          if (state.cancelled) return;
          state.failed = true;
          controller.error(error);
        }
      },
      async cancel(reason) {
        state.cancelled = true;
        await reader?.cancel(reason);
      },
    },
    // Read only when the driver asks, so nothing is read for a request that never starts.
    { highWaterMark: 0 },
  );
  /** Stops reading the body, also while the driver holds the counted stream. */
  const abort = async () => {
    await reader?.cancel().catch(() => undefined);
  };
  return { stream, state, abort };
};

/** A stream of `body` that fails rather than end before `expected` bytes. */
const expectBytes = (body: ReadableStream<Uint8Array>, expected: number) => {
  let received = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (received < expected) controller.error(new Error("the object ended short"));
      },
    }),
  );
};

const emptyStream = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });

// --- The adapter -------------------------------------------------------------------------------

/** A failure that ends an operation; `attempt` turns it into a result. */
class Stop extends Error {
  constructor(readonly failure: StorageFailure) {
    super(failure);
  }
}

const must = <T>(result: StorageResult<T>): T => {
  if (!result.ok) throw new Stop(result.failure);
  return result.value;
};

const attempt = async <T>(run: () => Promise<StorageResult<T>>): Promise<StorageResult<T>> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Stop) return fail(error.failure);
    console.error("object store operation failed", error);
    return fail("unavailable");
  }
};

/** Runs `work` on every item, at most `limit` at a time. */
const inParallel = async <T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
) => {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
};

/** What a path reaches, and what the store holds at its keys. */
interface Probe {
  readonly node: Node;
  /** The object at the file key, also when a collection hides it. */
  readonly file: ObjectInfo | null;
  /** Whether the collection has a marker object; the root counts as having one. */
  readonly marker: boolean;
}

const ROOT_PROBE: Probe = { node: "collection", file: null, marker: true };
const ABSENT_PROBE: Probe = { node: "absent", file: null, marker: false };

export const createObjectStoreStorage = (options: ObjectStoreOptions): StorageBackend => {
  const { driver, prefix, properties } = options;
  if (prefix !== "" && !prefix.endsWith("/")) {
    throw new Error("an object store's key prefix must be empty or end with /");
  }
  const now = options.now ?? Date.now;
  const maxFileSize = options.maxFileSize ?? MAX_UPLOAD_BYTES;
  const fits = (count: number) =>
    options.maxEntries === undefined || withinLimit(count, options.maxEntries);

  const probe = async (path: Path): Promise<Probe> => {
    if (path.length === 0) return ROOT_PROBE;
    const marker = markerKey(prefix, path);
    const [file, under] = await Promise.all([
      driver.head(fileKey(prefix, path)),
      driver.list(marker, { recursive: true, limit: 1 }),
    ]);
    const info = must(file);
    const first = must(under).objects[0];
    if (first) return { node: "collection", file: info, marker: first.key === marker };
    return { node: info ? "file" : "absent", file: info, marker: false };
  };

  /** Every key under `key`, page by page. */
  const listAll = async (key: string): Promise<ObjectInfo[]> => {
    const objects: ObjectInfo[] = [];
    let cursor: string | null = null;
    do {
      const page: ListPage = must(await driver.list(key, { recursive: true, cursor }));
      objects.push(...page.objects);
      cursor = page.cursor;
    } while (cursor !== null);
    return objects;
  };

  /** The entries directly inside the collection at `path`. */
  const listLevel = async (path: Path): Promise<Entry[]> => {
    const base = markerKey(prefix, path);
    const objects: ObjectInfo[] = [];
    const prefixes: string[] = [];
    let cursor: string | null = null;
    do {
      const page: ListPage = must(await driver.list(base, { recursive: false, cursor }));
      objects.push(...page.objects);
      prefixes.push(...page.prefixes);
      cursor = page.cursor;
    } while (cursor !== null);
    return readLevel(prefix, path, objects, prefixes);
  };

  /**
   * The paths that exist. Paths that share a parent, as the members of a collection do, are
   * found in one listing of the parent rather than two requests each.
   */
  const existingOf = async (paths: readonly Path[]): Promise<Path[]> => {
    const byParent = new Map<string, Path[]>();
    for (const path of paths) {
      const key = path.length === 0 ? "" : `/${pathKey(parentOf(path))}`;
      byParent.set(key, [...(byParent.get(key) ?? []), path]);
    }
    const found = await Promise.all(
      [...byParent.entries()].map(async ([key, group]): Promise<Path[]> => {
        const parent = group[0] ? parentOf(group[0]) : [];
        if (key === "" || group.length < 3) {
          const probes = await Promise.all(group.map((path) => probe(path)));
          return group.filter((_, index) => probes[index]?.node !== "absent");
        }
        if ((await probe(parent)).node !== "collection") return [];
        const names = new Set((await listLevel(parent)).map((entry) => entry.path.at(-1)));
        return group.filter((path) => names.has(path.at(-1)));
      }),
    );
    return found.flat();
  };

  /** The keys of the entry at `path` and everything under it; fails when any is hidden. */
  const keysOf = async (path: Path, found: Probe): Promise<string[]> => {
    if (found.node === "file") return [fileKey(prefix, path)];
    if (found.node !== "collection") return [];
    if (found.file) throw new Stop("hidden-objects");
    const objects = await listAll(markerKey(prefix, path));
    if (readTree(prefix, path, objects).hidden) throw new Stop("hidden-objects");
    return objects.map((object) => object.key);
  };

  const removeKeys = async (keys: readonly string[]) => {
    for (let index = 0; index < keys.length; index += DELETE_BATCH) {
      must(await driver.delete(keys.slice(index, index + DELETE_BATCH)));
    }
  };

  /** Writes the marker of a collection that has none, so it outlives its last entry. */
  const keepCollection = async (path: Path, found: Probe) => {
    if (found.node !== "collection" || found.marker) return;
    must(await driver.put(markerKey(prefix, path), null, { length: 0, created: now() }));
  };

  const transfer = async (
    from: Path,
    to: Path,
    overwrite: boolean,
    move: boolean,
    shallow: boolean,
  ): Promise<StorageResult<{ readonly replaced: boolean }>> => {
    const [source, destination, destinationParent, sourceParent] = await Promise.all([
      probe(from),
      probe(to),
      to.length === 0 ? ABSENT_PROBE : probe(parentOf(to)),
      move && from.length > 0 ? probe(parentOf(from)) : ABSENT_PROBE,
    ]);
    const facts = {
      sourceIsRoot: from.length === 0,
      source: source.node,
      // Either path inside the other: replacing an ancestor of the source would delete the source.
      inside: isWithin(to, from) || (to.length > 0 && isWithin(from, to)),
      destinationIsRoot: to.length === 0,
      destination: destination.node,
      destinationParent: destinationParent.node,
      overwrite,
    };
    const outcome = move ? decideMove(facts) : decideCopy(facts);
    if (outcome.kind !== "proceed") return fail(failureOf(outcome.kind));

    // Everything that can fail on hidden objects or on the limit fails before anything changes.
    const sourceKeys = source.node === "collection" && shallow ? [] : await keysOf(from, source);

    if (move && source.node === "collection") {
      const record = journalPath(from);
      const recorded = must(await properties.get([record]))[pathKey(record)] ?? [];
      const journal = recorded.find((property) => property.name === JOURNAL);
      if (resumeMove(journal?.xml === journalOf(to).xml, destination.node)) {
        if (!fits(sourceKeys.length)) return fail("too-many");
        // Whatever is left of the source goes over the destination, which keeps the rest, and so
        // do the properties of what is left.
        const sourceMarker = markerKey(prefix, from);
        const targetMarker = markerKey(prefix, to);
        await inParallel(sourceKeys, PARALLEL_COPIES, async (key) => {
          must(await driver.copy(key, `${targetMarker}${key.slice(sourceMarker.length)}`));
        });
        await keepCollection(parentOf(from), sourceParent);
        must(await properties.moveTree(from, to));
        await removeKeys(sourceKeys);
        must(await properties.removeTree(record));
        return ok({ replaced: true });
      }
    }
    const replacedKeys = outcome.replaces ? await keysOf(to, destination) : [];
    // A replaced destination is listed and removed in the same request, so it counts as well.
    if (!fits(sourceKeys.length + replacedKeys.length)) return fail("too-many");

    if (outcome.replaces) {
      await keepCollection(parentOf(to), destinationParent);
      await removeKeys(replacedKeys);
    }
    if (move) await keepCollection(parentOf(from), sourceParent);
    must(await properties.removeTree(to));
    // What arrives at the destination is not what a stopped move of that path, or of a path in it,
    // recorded: such a record would make a later move of the new content resume.
    must(await properties.removeTree(journalPath(to)));

    if (source.node === "file") {
      if (!must(await driver.copy(fileKey(prefix, from), fileKey(prefix, to)))) {
        return fail("not-found");
      }
    } else {
      const sourceMarker = markerKey(prefix, from);
      const targetMarker = markerKey(prefix, to);
      if (shallow || !source.marker) {
        must(await driver.put(targetMarker, null, { length: 0, created: now() }));
      }
      await inParallel(sourceKeys, PARALLEL_COPIES, async (key) => {
        // An object that went away since the listing is no longer part of the tree.
        must(await driver.copy(key, `${targetMarker}${key.slice(sourceMarker.length)}`));
      });
    }

    if (move) {
      // Recorded before the properties move: from here on, a retry resumes.
      if (source.node === "collection") {
        must(await properties.patch(journalPath(from), [journalOf(to)], []));
      }
      must(await properties.moveTree(from, to));
      await removeKeys(sourceKeys);
      // Also drops records that stopped moves of collections inside the source left.
      if (source.node === "collection") must(await properties.removeTree(journalPath(from)));
    } else if (shallow) {
      const own = must(await properties.get([from]))[pathKey(from)] ?? [];
      if (own.length > 0) must(await properties.patch(to, own, []));
    } else {
      must(await properties.copyTree(from, to));
    }
    return ok({ replaced: outcome.replaces });
  };

  return {
    stat: (path) =>
      attempt(async () => {
        const found = await probe(path);
        if (found.node === "collection") return ok(collectionEntry(path));
        if (found.node === "file" && found.file) return ok(fileEntry(path, found.file));
        return fail("not-found");
      }),

    list: (path) =>
      attempt(async () => {
        const found = await probe(path);
        if (found.node === "absent") return fail("not-found");
        if (found.node === "file") return fail("not-collection");
        return ok(await listLevel(path));
      }),

    read: (path, range?: ByteRange) =>
      attempt(async () => {
        const found = await probe(path);
        if (found.node === "absent") return fail("not-found");
        if (found.node === "collection" || !found.file) return fail("is-collection");
        const size = found.file.size;
        const start = Math.min(range?.start ?? 0, size);
        const stop = Math.min(range?.stop ?? size, size);
        if (stop <= start) return ok({ entry: fileEntry(path, found.file), body: emptyStream() });
        const whole = start === 0 && stop === size;
        const read = must(
          await driver.get(fileKey(prefix, path), whole ? undefined : { start, stop }),
        );
        if (!read) return fail("not-found");
        const expected = whole ? read.info.size : stop - start;
        return ok({ entry: fileEntry(path, read.info), body: expectBytes(read.body, expected) });
      }),

    write: (path, body, writeOptions) =>
      attempt(async () => {
        const cancel = () => body?.cancel().catch(() => undefined);
        const [target, parent] = await Promise.all([probe(path), probe(parentOf(path))]).catch(
          async (error: unknown) => {
            await cancel();
            throw error;
          },
        );
        const outcome = decideWrite(target.node, parent.node);
        if (outcome.kind !== "proceed") {
          await cancel();
          return fail(failureOf(outcome.kind));
        }
        if (writeOptions.ifAbsent && target.node !== "absent") {
          await cancel();
          return fail("exists");
        }
        const { size } = writeOptions;
        if (size !== undefined && size > maxFileSize) {
          await cancel();
          return fail("too-large");
        }
        const counted = countBytes(body, size, maxFileSize);
        try {
          // A new file takes no properties that an entry of its name left behind.
          if (!outcome.replaces) must(await properties.removeTree(path));
          const key = fileKey(prefix, path);
          const put = await driver.put(key, counted.stream, {
            length: size,
            contentType: writeOptions.contentType,
            created: target.file?.created ?? target.file?.modified ?? now(),
            ifNoneMatch: writeOptions.ifAbsent,
          });
          if (counted.state.tooLarge) return fail("too-large");
          if (counted.state.failed) return fail("size-mismatch");
          const { etag } = must(put);
          const stored = must(await driver.head(key));
          const entry = fileEntry(
            path,
            stored ?? {
              key,
              size: counted.state.bytes,
              etag,
              modified: now(),
              contentType: writeOptions.contentType,
            },
          );
          return ok({ entry, created: !outcome.replaces });
        } finally {
          await counted.abort();
        }
      }),

    createCollection: (path) =>
      attempt(async () => {
        const [target, parent] = await Promise.all([probe(path), probe(parentOf(path))]);
        const outcome = decideMkcol(
          path.length === 0,
          target.node,
          path.length === 0 ? "absent" : parent.node,
        );
        if (outcome.kind !== "proceed") return fail(failureOf(outcome.kind));
        must(await properties.removeTree(path));
        // A record that a stopped move of an earlier collection here left belongs to nothing now.
        must(await properties.removeTree(journalPath(path)));
        must(await driver.put(markerKey(prefix, path), null, { length: 0, created: now() }));
        return ok(collectionEntry(path));
      }),

    remove: (path) =>
      attempt(async () => {
        const [target, parent] = await Promise.all([
          probe(path),
          path.length > 1 ? probe(parentOf(path)) : ROOT_PROBE,
        ]);
        const outcome = decideRemove(path.length === 0, target.node);
        if (outcome.kind !== "proceed") return fail(failureOf(outcome.kind));
        const keys = await keysOf(path, target);
        await keepCollection(parentOf(path), parent);
        await removeKeys(keys);
        must(await properties.removeTree(path));
        // A record of a stopped move of what was removed belongs to nothing now.
        if (path.length > 0) must(await properties.removeTree(journalPath(path)));
        return ok(null);
      }),

    copy: (from, to, { overwrite, shallow }) =>
      attempt(() => transfer(from, to, overwrite, false, shallow)),

    move: (from, to, { overwrite }) => attempt(() => transfer(from, to, overwrite, true, false)),

    properties: (paths) =>
      attempt(async () => {
        const existing = await existingOf(paths);
        const stored = must(await properties.get(existing));
        const result: Record<string, readonly DeadProperty[]> = {};
        for (const path of existing) result[pathKey(path)] = stored[pathKey(path)] ?? [];
        return ok(result);
      }),

    patchProperties: (path, set, remove) =>
      attempt(async () => {
        if ((await probe(path)).node === "absent") return fail("not-found");
        return properties.patch(path, set, remove);
      }),

    usage: () =>
      attempt(async () => {
        const tree = readTree(prefix, [], await listAll(prefix));
        const bytes = tree.files.reduce((sum, file) => sum + file.info.size, 0);
        return ok({ files: tree.files.length, collections: tree.collections.length, bytes });
      }),
  };
};

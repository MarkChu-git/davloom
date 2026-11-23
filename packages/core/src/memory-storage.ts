import {
  decideCopy,
  decideMkcol,
  decideMove,
  decideRemove,
  decideWrite,
  type Node,
} from "@davloom/laws";
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
  type StorageBackend,
  type StorageFailure,
  type StorageResult,
} from "./storage";

// A backend held in memory. It is the reference the storage contract tests compare other adapters
// with, and the backend of the protocol engine's unit tests.

interface Item {
  kind: "file" | "collection";
  content: Uint8Array;
  etag: string;
  modified: number;
  created: number;
  contentType: string | null;
  properties: Map<string, DeadProperty>;
}

export interface MemoryStorageOptions {
  /** The most bytes the backend holds; a write past it fails with insufficient storage. */
  readonly capacity?: number;
  /** The largest file; a larger write fails as too large. */
  readonly maxFileSize?: number;
  readonly now?: () => number;
}

const readAll = async (body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> => {
  if (!body) return new Uint8Array();
  return new Uint8Array(await new Response(body).arrayBuffer());
};

const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes);
      controller.close();
    },
  });

const failWith = <T>(failure: StorageFailure): Promise<StorageResult<T>> =>
  Promise.resolve(fail<T>(failure));

export const createMemoryStorage = (options: MemoryStorageOptions = {}): StorageBackend => {
  const now = options.now ?? Date.now;
  const capacity = options.capacity ?? Number.POSITIVE_INFINITY;
  const maxFileSize = options.maxFileSize ?? Number.POSITIVE_INFINITY;
  const items = new Map<string, Item>();
  let counter = 0;
  const nextTag = () => `m${(counter += 1).toString(36)}`;
  const created = now();
  const root: Item = {
    kind: "collection",
    content: new Uint8Array(),
    etag: nextTag(),
    modified: created,
    created,
    contentType: null,
    properties: new Map(),
  };

  const get = (path: Path): Item | undefined =>
    path.length === 0 ? root : items.get(pathKey(path));
  const nodeOf = (path: Path): Node => get(path)?.kind ?? "absent";
  const entryOf = (path: Path, item: Item): Entry => ({
    path,
    kind: item.kind,
    size: item.kind === "file" ? item.content.length : 0,
    etag: item.etag,
    modified: item.modified,
    created: item.created,
    contentType: item.contentType,
  });
  const used = () => [...items.values()].reduce((sum, item) => sum + item.content.length, 0);
  const subtree = (path: Path): [string, Item][] => {
    const key = pathKey(path);
    return [...items.entries()].filter(([k]) => k === key || k.startsWith(`${key}/`));
  };
  const removeTree = (path: Path) => {
    for (const [key] of subtree(path)) items.delete(key);
  };
  const touch = (path: Path) => {
    const parent = get(path);
    if (parent) parent.modified = now();
  };

  const transfer = (
    from: Path,
    to: Path,
    overwrite: boolean,
    move: boolean,
    shallow: boolean,
  ): StorageResult<{ replaced: boolean }> => {
    const facts = {
      sourceIsRoot: from.length === 0,
      source: nodeOf(from),
      inside: isWithin(to, from),
      destinationIsRoot: to.length === 0,
      destination: nodeOf(to),
      destinationParent: to.length === 0 ? ("absent" as const) : nodeOf(parentOf(to)),
      overwrite,
    };
    const outcome = move ? decideMove(facts) : decideCopy(facts);
    if (outcome.kind !== "proceed") return fail(failureOf(outcome.kind));
    const sourceKey = pathKey(from);
    const copied = subtree(from).filter(([key]) => !shallow || key === sourceKey);
    const added = move ? 0 : copied.reduce((sum, [, item]) => sum + item.content.length, 0);
    const freed = outcome.replaces
      ? subtree(to).reduce((sum, [, item]) => sum + item.content.length, 0)
      : 0;
    if (used() - freed + added > capacity) return fail("insufficient-storage");
    if (outcome.replaces) removeTree(to);
    const time = now();
    for (const [key, item] of copied) {
      const target = `${pathKey(to)}${key.slice(sourceKey.length)}`;
      items.set(
        target,
        move
          ? item
          : {
              ...item,
              etag: nextTag(),
              created: time,
              modified: time,
              properties: new Map(item.properties),
            },
      );
    }
    if (move) removeTree(from);
    touch(parentOf(to));
    if (move) touch(parentOf(from));
    return ok({ replaced: outcome.replaces });
  };

  return {
    stat: (path) => {
      const item = get(path);
      return Promise.resolve(item ? ok(entryOf(path, item)) : fail("not-found"));
    },
    list: (path) => {
      const item = get(path);
      if (!item) return failWith("not-found");
      if (item.kind !== "collection") return failWith("not-collection");
      const prefix = path.length === 0 ? "" : `${pathKey(path)}/`;
      const children: Entry[] = [];
      for (const [key, child] of items) {
        if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
          children.push(entryOf([...path, key.slice(prefix.length)], child));
        }
      }
      return Promise.resolve(ok(children));
    },
    read: (path, range?: ByteRange) => {
      const item = get(path);
      if (!item) return failWith("not-found");
      if (item.kind !== "file") return failWith("is-collection");
      const bytes = range ? item.content.slice(range.start, range.stop) : item.content;
      return Promise.resolve(ok({ entry: entryOf(path, item), body: streamOf(bytes) }));
    },
    write: async (path, body, writeOptions) => {
      const outcome = decideWrite(nodeOf(path), nodeOf(parentOf(path)));
      if (outcome.kind !== "proceed") return fail(failureOf(outcome.kind));
      if (writeOptions.size !== undefined && writeOptions.size > maxFileSize)
        return fail("too-large");
      let content: Uint8Array;
      try {
        content = await readAll(body);
      } catch {
        return fail("size-mismatch");
      }
      if (writeOptions.size !== undefined && content.length !== writeOptions.size)
        return fail("size-mismatch");
      if (content.length > maxFileSize) return fail("too-large");
      // The tree may have changed while the body arrived, so decide again.
      const again = decideWrite(nodeOf(path), nodeOf(parentOf(path)));
      if (again.kind !== "proceed") return fail(failureOf(again.kind));
      const previous = items.get(pathKey(path));
      if (used() - (previous?.content.length ?? 0) + content.length > capacity) {
        return fail("insufficient-storage");
      }
      const time = now();
      const item: Item = {
        kind: "file",
        content,
        etag: nextTag(),
        modified: time,
        created: previous?.created ?? time,
        contentType: writeOptions.contentType ?? null,
        properties: previous?.properties ?? new Map(),
      };
      items.set(pathKey(path), item);
      touch(parentOf(path));
      return ok({ entry: entryOf(path, item), created: !again.replaces });
    },
    createCollection: (path) => {
      const outcome = decideMkcol(
        path.length === 0,
        nodeOf(path),
        path.length === 0 ? "absent" : nodeOf(parentOf(path)),
      );
      if (outcome.kind !== "proceed") return failWith(failureOf(outcome.kind));
      const time = now();
      const item: Item = {
        kind: "collection",
        content: new Uint8Array(),
        etag: nextTag(),
        modified: time,
        created: time,
        contentType: null,
        properties: new Map(),
      };
      items.set(pathKey(path), item);
      touch(parentOf(path));
      return Promise.resolve(ok(entryOf(path, item)));
    },
    remove: (path) => {
      const outcome = decideRemove(path.length === 0, nodeOf(path));
      if (outcome.kind !== "proceed") return failWith(failureOf(outcome.kind));
      removeTree(path);
      touch(parentOf(path));
      return Promise.resolve(ok(null));
    },
    copy: (from, to, { overwrite, shallow }) =>
      Promise.resolve(transfer(from, to, overwrite, false, shallow)),
    move: (from, to, { overwrite }) => Promise.resolve(transfer(from, to, overwrite, true, false)),
    properties: (paths) => {
      const result: Record<string, readonly DeadProperty[]> = {};
      for (const path of paths) {
        const item = get(path);
        if (item) result[pathKey(path)] = [...item.properties.values()];
      }
      return Promise.resolve(ok(result));
    },
    patchProperties: (path, set, remove) => {
      const item = get(path);
      if (!item) return failWith("not-found");
      for (const property of set) item.properties.set(property.name, property);
      for (const name of remove) item.properties.delete(name);
      return Promise.resolve(ok(null));
    },
    usage: () => {
      let files = 0;
      let collections = 0;
      for (const item of items.values()) {
        if (item.kind === "file") files += 1;
        else collections += 1;
      }
      return Promise.resolve(ok({ files, collections, bytes: used() }));
    },
  };
};

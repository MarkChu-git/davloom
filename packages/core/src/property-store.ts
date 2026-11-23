import { fail, ok, pathKey, type DeadProperty, type Path, type StorageResult } from "./storage";

// The Property Store Port: dead properties kept apart from a backend's content, for backends that
// cannot keep them themselves. An object store has no place for the properties of a collection and
// cannot change an object's metadata in place, so its adapter keeps them here, keyed by the path
// of the entry within that one backend. The adapter decides which paths exist; the store only
// keeps what it is told, and moves whole subtrees with their entries.

export interface PropertyStore {
  /** The properties of each path, keyed by `pathKey`; a path without any maps to an empty list. */
  get(paths: readonly Path[]): Promise<StorageResult<Record<string, readonly DeadProperty[]>>>;
  /** Sets, then removes, properties of one path. */
  patch(
    path: Path,
    set: readonly DeadProperty[],
    remove: readonly string[],
  ): Promise<StorageResult<null>>;
  /**
   * Copies the properties of `from` and of every path under it to the same places under `to`,
   * replacing properties of the same name there. Neither path may be the root.
   */
  copyTree(from: Path, to: Path): Promise<StorageResult<null>>;
  /** As `copyTree`, and then removes the properties under `from`. */
  moveTree(from: Path, to: Path): Promise<StorageResult<null>>;
  /** Removes the properties of `path` and of every path under it; the root removes everything. */
  removeTree(path: Path): Promise<StorageResult<null>>;
}

/** Whether the key `key` names `root` or a path under it. */
export const isKeyWithin = (key: string, root: string): boolean =>
  root === "" || key === root || key.startsWith(`${root}/`);

/** By UTF-16 code unit, which only astral characters order apart from SQLite's bytes. */
const byName = (a: DeadProperty, b: DeadProperty) =>
  Number(a.name > b.name) - Number(a.name < b.name);

/** A Property Store held in memory, for tests and for the reference adapters. */
export const createMemoryPropertyStore = (): PropertyStore => {
  const store = new Map<string, Map<string, DeadProperty>>();
  const under = (root: string) => [...store.entries()].filter(([key]) => isKeyWithin(key, root));
  const copy = (from: Path, to: Path, move: boolean): StorageResult<null> => {
    if (from.length === 0 || to.length === 0) return fail("root");
    const source = pathKey(from);
    const target = pathKey(to);
    const moved = under(source);
    if (move) for (const [key] of moved) store.delete(key);
    for (const [key, properties] of moved) {
      const destination = `${target}${key.slice(source.length)}`;
      const existing = store.get(destination) ?? new Map<string, DeadProperty>();
      for (const property of properties.values()) existing.set(property.name, property);
      store.set(destination, existing);
    }
    return ok(null);
  };
  return {
    get: (paths) => {
      const result: Record<string, readonly DeadProperty[]> = {};
      for (const path of paths) {
        result[pathKey(path)] = [...(store.get(pathKey(path))?.values() ?? [])].toSorted(byName);
      }
      return Promise.resolve(ok(result));
    },
    patch: (path, set, remove) => {
      const key = pathKey(path);
      const properties = store.get(key) ?? new Map<string, DeadProperty>();
      for (const property of set) properties.set(property.name, property);
      for (const name of remove) properties.delete(name);
      if (properties.size > 0) store.set(key, properties);
      else store.delete(key);
      return Promise.resolve(ok(null));
    },
    copyTree: (from, to) => Promise.resolve(copy(from, to, false)),
    moveTree: (from, to) => Promise.resolve(copy(from, to, true)),
    removeTree: (path) => {
      for (const [key] of under(pathKey(path))) store.delete(key);
      return Promise.resolve(ok(null));
    },
  };
};

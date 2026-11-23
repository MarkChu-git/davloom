import {
  fail,
  ok,
  pathKey,
  type DeadProperty,
  type Entry,
  type Path,
  type StorageBackend,
  type StorageResult,
} from "./storage";

// The WebDAV namespace: a virtual root whose members are the Mounts, each a path in a backend.
// `/dav/<mount>/<path>` reaches `<root>/<path>` in the Mount's backend. A Mount's own root behaves
// like a backend's root: it cannot be written, removed, moved or replaced.

export interface Mount {
  readonly name: string;
  /** Identifies the backend, so two Mounts on one backend can copy and move between them. */
  readonly backendId: string;
  readonly backend: StorageBackend;
  /** The Mount's root in the backend. */
  readonly root: Path;
}

interface Located {
  readonly mount: Mount;
  readonly path: Path;
  readonly isMountRoot: boolean;
}

/** The failure for an operation on the virtual root or on a name that is not a Mount. */
const outside = <T>(path: Path): StorageResult<T> => fail(path.length <= 1 ? "root" : "not-found");

export const createMountedStorage = (mounts: readonly Mount[], created = 0): StorageBackend => {
  const byName = new Map(mounts.map((mount) => [mount.name, mount]));
  const locate = (path: Path): Located | null => {
    const [name, ...rest] = path;
    const mount = name === undefined ? undefined : byName.get(name);
    return mount ? { mount, path: [...mount.root, ...rest], isMountRoot: rest.length === 0 } : null;
  };
  const toDav = (mount: Mount, entry: Entry): Entry => ({
    ...entry,
    path: [mount.name, ...entry.path.slice(mount.root.length)],
  });
  const rootEntry: Entry = {
    path: [],
    kind: "collection",
    size: 0,
    etag: "root",
    modified: created,
    created,
    contentType: null,
  };

  const transfer = async (
    from: Path,
    to: Path,
    run: (
      backend: StorageBackend,
      from: Path,
      to: Path,
    ) => Promise<StorageResult<{ replaced: boolean }>>,
    move: boolean,
  ): Promise<StorageResult<{ readonly replaced: boolean }>> => {
    const source = locate(from);
    if (!source) return from.length === 0 ? fail(move ? "root" : "into-itself") : fail("not-found");
    const target = locate(to);
    if (!target) return fail("root");
    if ((move && source.isMountRoot) || target.isMountRoot) return fail("root");
    if (source.mount.backendId !== target.mount.backendId) return fail("cross-backend");
    return await run(source.mount.backend, source.path, target.path);
  };

  return {
    stat: async (path) => {
      if (path.length === 0) return ok(rootEntry);
      const located = locate(path);
      if (!located) return fail("not-found");
      const result = await located.mount.backend.stat(located.path);
      return result.ok ? ok(toDav(located.mount, result.value)) : result;
    },
    list: async (path) => {
      if (path.length === 0) {
        const entries: Entry[] = [];
        for (const mount of mounts) {
          const result = await mount.backend.stat(mount.root);
          if (result.ok) entries.push(toDav(mount, result.value));
        }
        return ok(entries);
      }
      const located = locate(path);
      if (!located) return fail("not-found");
      const result = await located.mount.backend.list(located.path);
      return result.ok ? ok(result.value.map((entry) => toDav(located.mount, entry))) : result;
    },
    read: async (path, range) => {
      const located = locate(path);
      if (!located) return fail(path.length === 0 ? "is-collection" : "not-found");
      const result = await located.mount.backend.read(located.path, range);
      return result.ok
        ? ok({ ...result.value, entry: toDav(located.mount, result.value.entry) })
        : result;
    },
    write: async (path, body, options) => {
      const located = locate(path);
      if (!located || located.isMountRoot) {
        await body?.cancel();
        return located ? fail("is-collection") : outside(path);
      }
      const result = await located.mount.backend.write(located.path, body, options);
      return result.ok
        ? ok({ ...result.value, entry: toDav(located.mount, result.value.entry) })
        : result;
    },
    createCollection: async (path) => {
      const located = locate(path);
      if (!located) return path.length === 0 ? fail("exists") : outside(path);
      if (located.isMountRoot) return fail("exists");
      const result = await located.mount.backend.createCollection(located.path);
      return result.ok ? ok(toDav(located.mount, result.value)) : result;
    },
    remove: async (path) => {
      const located = locate(path);
      if (!located) return outside(path);
      if (located.isMountRoot) return fail("root");
      return await located.mount.backend.remove(located.path);
    },
    copy: (from, to, options) =>
      transfer(from, to, (backend, a, b) => backend.copy(a, b, options), false),
    move: (from, to, options) =>
      transfer(from, to, (backend, a, b) => backend.move(a, b, options), true),
    properties: async (paths) => {
      const result: Record<string, readonly DeadProperty[]> = {};
      const groups = new Map<Mount, { dav: Path; backend: Path }[]>();
      for (const path of paths) {
        const located = locate(path);
        if (!located) continue;
        const group = groups.get(located.mount) ?? [];
        group.push({ dav: path, backend: located.path });
        groups.set(located.mount, group);
      }
      for (const [mount, group] of groups) {
        const found = await mount.backend.properties(group.map((item) => item.backend));
        if (!found.ok) return found;
        for (const item of group) {
          const properties = found.value[pathKey(item.backend)];
          if (properties) result[pathKey(item.dav)] = properties;
        }
      }
      return ok(result);
    },
    patchProperties: async (path, set, remove) => {
      const located = locate(path);
      if (!located) return path.length === 0 ? fail("root") : fail("not-found");
      return await located.mount.backend.patchProperties(located.path, set, remove);
    },
    quota: async (path) => {
      const located = locate(path);
      if (!located) return fail(path.length === 0 ? "not-collection" : "not-found");
      const backend = located.mount.backend;
      if (backend.quota) return await backend.quota(located.path);
      const usage = await backend.usage();
      return usage.ok ? ok({ used: usage.value.bytes, available: null }) : usage;
    },
    usage: async () => {
      const seen = new Set<string>();
      let files = 0;
      let collections = 0;
      let bytes = 0;
      for (const mount of mounts) {
        if (seen.has(mount.backendId)) continue;
        seen.add(mount.backendId);
        const result = await mount.backend.usage();
        if (!result.ok) return result;
        files += result.value.files;
        collections += result.value.collections;
        bytes += result.value.bytes;
      }
      return ok({ files, collections, bytes });
    },
  };
};

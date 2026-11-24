import {
  mountRoute,
  mountTransfer,
  type MountOp,
  type MountRoute,
  type MountWhere,
} from "@davloom/laws";
import {
  fail,
  ok,
  pathKey,
  type DeadProperty,
  type Entry,
  type Path,
  type StorageBackend,
  type StorageFailure,
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

const whereOf = (path: Path, located: Located | null): MountWhere =>
  located
    ? located.isMountRoot
      ? "mount-root"
      : "inside"
    : path.length === 0
      ? "root"
      : path.length === 1
        ? "unknown-top"
        : "unknown-deep";

/**
 * The failure a route answers. A route to a backend or the namespace's own answer never gets
 * here: the laws give those only to a path inside a Mount, or to a stat or listing of the root.
 */
const failureOfRoute = (route: MountRoute): StorageFailure =>
  route === "delegate" || route === "virtual" ? "unavailable" : route;

export const createMountedStorage = (mounts: readonly Mount[], created = 0): StorageBackend => {
  const byName = new Map(mounts.map((mount) => [mount.name, mount]));
  const locate = (path: Path): Located | null => {
    const [name, ...rest] = path;
    const mount = name === undefined ? undefined : byName.get(name);
    return mount ? { mount, path: [...mount.root, ...rest], isMountRoot: rest.length === 0 } : null;
  };
  /**
   * Where a path lies, and the proven route of `op` on it: the Mount to ask, the namespace's own
   * answer, or a failure.
   */
  const routeOf = (op: MountOp, path: Path) => {
    const located = locate(path);
    const route = mountRoute(op, whereOf(path, located));
    return { located, route };
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
    const target = locate(to);
    const route = mountTransfer(
      whereOf(from, source),
      whereOf(to, target),
      move,
      source !== null && target !== null && source.mount.backendId === target.mount.backendId,
    );
    if (route !== "delegate" || !source || !target) return fail(failureOfRoute(route));
    return await run(source.mount.backend, source.path, target.path);
  };

  return {
    stat: async (path) => {
      const { located, route } = routeOf("stat", path);
      if (route === "virtual") return ok(rootEntry);
      if (route !== "delegate" || !located) return fail(failureOfRoute(route));
      const result = await located.mount.backend.stat(located.path);
      return result.ok ? ok(toDav(located.mount, result.value)) : result;
    },
    list: async (path) => {
      const { located, route } = routeOf("list", path);
      if (route === "virtual") {
        const entries: Entry[] = [];
        for (const mount of mounts) {
          const result = await mount.backend.stat(mount.root);
          if (result.ok) entries.push(toDav(mount, result.value));
        }
        return ok(entries);
      }
      if (route !== "delegate" || !located) return fail(failureOfRoute(route));
      const result = await located.mount.backend.list(located.path);
      return result.ok ? ok(result.value.map((entry) => toDav(located.mount, entry))) : result;
    },
    read: async (path, range) => {
      const { located, route } = routeOf("read", path);
      if (route !== "delegate" || !located) return fail(failureOfRoute(route));
      const result = await located.mount.backend.read(located.path, range);
      return result.ok
        ? ok({ ...result.value, entry: toDav(located.mount, result.value.entry) })
        : result;
    },
    write: async (path, body, options) => {
      const { located, route } = routeOf("write", path);
      if (route !== "delegate" || !located) {
        await body?.cancel();
        return fail(failureOfRoute(route));
      }
      const result = await located.mount.backend.write(located.path, body, options);
      return result.ok
        ? ok({ ...result.value, entry: toDav(located.mount, result.value.entry) })
        : result;
    },
    createCollection: async (path) => {
      const { located, route } = routeOf("mkcol", path);
      if (route !== "delegate" || !located) return fail(failureOfRoute(route));
      const result = await located.mount.backend.createCollection(located.path);
      return result.ok ? ok(toDav(located.mount, result.value)) : result;
    },
    remove: async (path) => {
      const { located, route } = routeOf("remove", path);
      if (route !== "delegate" || !located) return fail(failureOfRoute(route));
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
      const { located, route } = routeOf("patch", path);
      if (route !== "delegate" || !located) return fail(failureOfRoute(route));
      return await located.mount.backend.patchProperties(located.path, set, remove);
    },
    quota: async (path) => {
      const { located, route } = routeOf("quota", path);
      if (route !== "delegate" || !located) return fail(failureOfRoute(route));
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

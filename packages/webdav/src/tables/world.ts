import {
  createMemoryStorage,
  createMountedStorage,
  fail,
  parentOf,
  relationOf,
  scopeStorage,
  type Mount,
  type Path,
  type Scope,
  type StorageBackend,
} from "@davloom/core";
import { authorizeScoped, type Access } from "@davloom/laws";
import { createWebDavHandler } from "../handler";
import { createMemoryLockStore } from "../locks";
import type { Refuses } from "./names-cases";

// The namespace the table tests run against: two Mounts, each on its own memory backend. The
// `files` Mount can exist, have a backend that is unavailable, or not exist at all; `media` always
// exists. A key reaches it through the real handler with the proven policy, as the API wires it.

export const ORIGIN = "https://dav.example";
export const BASE = "/dav";

export type MountState = "exists" | "unavailable" | "missing";

/** Content of every file in the world, so a test can tell whether one leaked or changed. */
export const FILES: Readonly<Record<string, string>> = {
  "files/photos/a.jpg": "photo-a-content",
  "files/photos/sub/b.jpg": "photo-b-content",
  "files/docs/secret.txt": "top-secret-content",
  "files/photos2/z.txt": "neighbour-content",
  "media/music/c.mp3": "music-c-content",
};

/** Every collection in the world, below the Mount roots. */
export const COLLECTIONS: readonly string[] = [
  "files/photos",
  "files/photos/sub",
  "files/docs",
  "files/photos2",
  "media/music",
];

/** A backend whose every operation fails as unavailable, like a storage service that is down. */
const down = () => Promise.resolve(fail("unavailable"));

export const unavailableBackend = (): StorageBackend => {
  return {
    stat: down,
    list: down,
    read: down,
    write: async (_path, body) => {
      await body?.cancel();
      return fail("unavailable");
    },
    createCollection: down,
    remove: down,
    copy: down,
    move: down,
    properties: down,
    patchProperties: down,
    usage: down,
    quota: down,
  };
};

/**
 * A backend on a store that refuses some names, as the object-store adapter on RustFS answers: a
 * refused name is never stored, so it reads as absent, and an operation that would create an
 * entry with it fails with `name-refused` once it has checked everything else and changed nothing.
 */
export const refusingBackend = (inner: StorageBackend, refuses: Refuses): StorageBackend => {
  /** Whether creating an entry of `kind` at `path` reaches the store and is refused there. */
  const refused = async (path: Path, kind: "file" | "collection") => {
    if (path.length === 0 || !refuses(path, kind)) return false;
    const parent = await inner.stat(parentOf(path));
    return parent.ok && parent.value.kind === "collection" && !(await inner.stat(path)).ok;
  };
  /** Whether a copy or move from `from` would create a refused entry at `to`. */
  const refusedTransfer = async (from: Path, to: Path) => {
    const source = await inner.stat(from);
    return source.ok && (await refused(to, source.value.kind));
  };
  return {
    ...inner,
    write: async (path, body, options) => {
      if (await refused(path, "file")) {
        await body?.cancel();
        return fail("name-refused");
      }
      return inner.write(path, body, options);
    },
    createCollection: async (path) =>
      (await refused(path, "collection")) ? fail("name-refused") : inner.createCollection(path),
    copy: async (from, to, options) =>
      (await refusedTransfer(from, to)) ? fail("name-refused") : inner.copy(from, to, options),
    move: async (from, to, options) =>
      (await refusedTransfer(from, to)) ? fail("name-refused") : inner.move(from, to, options),
  };
};

const seed = async (backend: StorageBackend, mount: string) => {
  for (const collection of COLLECTIONS) {
    const [name, ...rest] = collection.split("/");
    if (name === mount) await backend.createCollection(rest);
  }
  for (const [file, content] of Object.entries(FILES)) {
    const [name, ...rest] = file.split("/");
    if (name === mount) await backend.write(rest, new Blob([content]).stream(), {});
  }
};

export interface WorldOptions {
  readonly files?: MountState;
  /** The key's roots, or null for a key that reaches every Mount. */
  readonly scope?: Scope;
  readonly access?: Access;
  /** Names the store behind the `files` Mount refuses, as RustFS does on the self-hosted target. */
  readonly refuses?: Refuses;
}

export interface Call {
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

const time = () => Date.UTC(2026, 10, 1);

export const buildWorld = async (options: WorldOptions = {}) => {
  const state = options.files ?? "exists";
  const filesBackend = createMemoryStorage({ now: time });
  const mediaBackend = createMemoryStorage({ now: time });
  await seed(filesBackend, "files");
  await seed(mediaBackend, "media");
  const mounts: Mount[] = [{ name: "media", backendId: "media", backend: mediaBackend, root: [] }];
  if (state !== "missing") {
    mounts.unshift({
      name: "files",
      backendId: "files",
      backend:
        state !== "exists"
          ? unavailableBackend()
          : options.refuses
            ? refusingBackend(filesBackend, options.refuses)
            : filesBackend,
      root: [],
    });
  }
  const namespace = createMountedStorage(mounts, Date.UTC(2026, 9, 1));
  const locks = createMemoryLockStore();
  const scope = options.scope ?? null;
  const access = options.access ?? "read-write";
  const handler = createWebDavHandler({
    basePath: BASE,
    storage: scopeStorage(namespace, scope),
    locks,
    now: () => Date.UTC(2026, 10, 2),
    authorize: ({ method, target, destination }) =>
      authorizeScoped({
        access,
        method,
        target: relationOf(target, scope),
        destination: destination === null ? "outside" : relationOf(destination, scope),
      }),
  });
  /** Sends a request; `path` is everything after the base path, raw, as a client would send it. */
  const call = async (method: string, path: string, request: Call = {}) =>
    await handler(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method,
        headers: request.headers,
        body: request.body,
      }),
    );
  return {
    call,
    handler,
    namespace,
    locks,
    backends: { files: filesBackend, media: mediaBackend },
  };
};

export type World = Awaited<ReturnType<typeof buildWorld>>;

/** Every entry of a backend with its kind, content and dead properties, keyed by its path. */
export const snapshot = async (
  backend: StorageBackend,
  prefix: string,
): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  const visit = async (path: Path) => {
    const listed = await backend.list(path);
    if (!listed.ok) return;
    const properties = await backend.properties(listed.value.map((entry) => entry.path));
    const dead = properties.ok ? properties.value : {};
    for (const entry of listed.value) {
      const key = [prefix, ...entry.path].join("/");
      const props = JSON.stringify(dead[entry.path.join("/")] ?? []);
      if (entry.kind === "collection") {
        result[`${key}/`] = `collection ${props}`;
        await visit(entry.path);
      } else {
        const read = await backend.read(entry.path);
        const text = read.ok ? await new Response(read.value.body).text() : "";
        result[key] = `file ${text} ${props}`;
      }
    }
  };
  await visit([]);
  return result;
};

/** The snapshot of both Mounts' backends together. */
export const snapshotAll = async (world: World) => ({
  ...(await snapshot(world.backends.files, "files")),
  ...(await snapshot(world.backends.media, "media")),
});

/** Whether a snapshot key (`files/photos/a.jpg`, a collection's ends in `/`) lies under a root. */
export const under = (key: string, root: string) =>
  key === root || key === `${root}/` || key.startsWith(`${root}/`);

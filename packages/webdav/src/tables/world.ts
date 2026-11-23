import {
  createMemoryStorage,
  createMountedStorage,
  fail,
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
      backend: state === "exists" ? filesBackend : unavailableBackend(),
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

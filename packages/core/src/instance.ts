import { Context, Data, Effect, Redacted } from "effect";
import { checkR2Config, checkS3Config } from "./backend-config";
import { CredentialCipher } from "./credentials";
import { isValidName, isValidPath, type Access } from "@davloom/laws";
import { createMountedStorage, type Mount } from "./mounts";
import { formatRoot, parseScope, type Scope } from "./scope";
import type { Path, StorageBackend, StorageFailure, StorageResult, Usage } from "./storage";

// The application services of one Davloom instance: first-run setup, API Keys, storage backends and
// Mounts, and the credential check of WebDAV requests. They reach the database, the identity
// provider and the storage backends only through the Ports below.

export interface BackendRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** The kind's configuration, without secrets. */
  readonly config: unknown;
  /** An S3-compatible backend's secret key, sealed by the credential cipher; else null. */
  readonly secretKey: string | null;
  readonly createdAt: Date;
}

export interface MountRecord {
  readonly id: string;
  readonly name: string;
  readonly backendId: string;
  readonly backendKind: string;
  readonly root: string;
  readonly createdAt: Date;
}

export interface ApiKeyRecord {
  readonly id: string;
  readonly name: string | null;
  readonly start: string | null;
  readonly enabled: boolean;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly metadata: unknown;
  /** When a WebDAV client last signed in with the key, to within USE_RECORD_INTERVAL_MS. */
  readonly lastUsedAt: Date | null;
}

/** The Port to the instance database. */
export class Records extends Context.Service<
  Records,
  {
    readonly users: { readonly count: () => Promise<number> };
    readonly backends: {
      readonly list: () => Promise<BackendRecord[]>;
      readonly create: (record: {
        id: string;
        name: string;
        kind: string;
        config: unknown;
        secretKey?: string | null;
      }) => Promise<void>;
    };
    readonly mounts: {
      readonly list: () => Promise<MountRecord[]>;
      readonly create: (record: {
        id: string;
        name: string;
        backendId: string;
        root: string;
      }) => Promise<void>;
      readonly rename: (id: string, name: string) => Promise<boolean>;
      /** Points a Mount at another backend or path; false when no Mount has the id. */
      readonly retarget: (id: string, backendId: string, root: string) => Promise<boolean>;
      readonly remove: (id: string) => Promise<boolean>;
    };
    readonly apiKeys: {
      readonly findByHash: (hash: string) => Promise<ApiKeyRecord | null>;
      readonly list: () => Promise<ApiKeyRecord[]>;
      readonly remove: (id: string) => Promise<boolean>;
      /** Renames a key; false when no key has the id. */
      readonly rename: (id: string, name: string) => Promise<boolean>;
      /** Records that a WebDAV client signed in with the key at `at`. */
      readonly recordUse: (id: string, at: Date) => Promise<void>;
    };
  }
>()("@davloom/core/Records") {}

/** The Port to the identity provider (Better Auth). */
export class Identity extends Context.Service<
  Identity,
  {
    readonly createAdmin: (details: {
      name: string;
      email: string;
      password: string;
    }) => Promise<{ id: string }>;
    /** The signed-in user of a request, or null. */
    readonly sessionUser: (
      headers: Headers,
    ) => Promise<{ id: string; name: string; email: string } | null>;
    readonly createApiKey: (details: {
      userId: string;
      name: string;
      expiresIn: number | null;
      metadata: KeyMetadata;
    }) => Promise<{ id: string; key: string }>;
  }
>()("@davloom/core/Identity") {}

/** The Port that opens a backend's Storage Port. */
export class StorageOpener extends Context.Service<
  StorageOpener,
  { readonly open: (backend: BackendRecord) => StorageBackend | null }
>()("@davloom/core/StorageOpener") {}

/** Instance settings that come from the deployment. */
export class InstanceConfig extends Context.Service<
  InstanceConfig,
  {
    /** The token the first-run setup asks for; setup is closed without one. */
    readonly setupToken: string | null;
    /** The storage kinds this runtime can open; the first is the default for new backends. */
    readonly storageKinds: readonly string[];
    /** The backend the first-run setup creates, when the deployment names one (self-hosted). */
    readonly defaultBackend?: {
      readonly kind: string;
      readonly config: unknown;
      readonly secretKey: Redacted.Redacted | null;
    } | null;
  }
>()("@davloom/core/InstanceConfig") {}

export class SetupClosed extends Data.TaggedError("SetupClosed")<{}> {}
export class SetupTokenInvalid extends Data.TaggedError("SetupTokenInvalid")<{}> {}
export class InvalidInput extends Data.TaggedError("InvalidInput")<{ readonly field: string }> {}
export class NotFound extends Data.TaggedError("NotFound")<{}> {}
export class NameTaken extends Data.TaggedError("NameTaken")<{}> {}
export class Unauthorized extends Data.TaggedError("Unauthorized")<{}> {}
/** An API Key is limited to the Mount, so it keeps its name until the key is revoked. */
export class MountInUse extends Data.TaggedError("MountInUse")<{}> {}

export interface KeyMetadata {
  readonly access: Access;
  /** The roots the key is limited to, as `/mount/folder`; absent for every Mount. */
  readonly paths?: readonly string[];
}

const promise = <A>(run: () => Promise<A>) => Effect.promise(run);

const isUnique = (error: unknown) => {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (/UNIQUE constraint failed/i.test(current.message)) return true;
  }
  return false;
};

/** Runs an insert, turning a unique constraint failure into NameTaken. */
const insert = (run: () => Promise<void>) =>
  Effect.tryPromise({ try: run, catch: (error) => error }).pipe(
    Effect.catch((error) => (isUnique(error) ? Effect.fail(new NameTaken()) : Effect.die(error))),
  );

/** Compares two secrets in time that does not depend on where they differ. */
export const constantTimeEqual = (a: string, b: string) => {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
};

export const DEFAULT_MOUNT = "files";

// --- Setup ---------------------------------------------------------------------------------

export const setupStatus = Effect.gen(function* () {
  const records = yield* Records;
  const config = yield* InstanceConfig;
  const users = yield* promise(() => records.users.count());
  return { needed: users === 0, open: users === 0 && config.setupToken !== null };
});

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** Creates the administrator, a default backend and its Mount. Only while no user exists. */
export const completeSetup = (input: {
  name: string;
  email: string;
  password: string;
  token: string;
}) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const identity = yield* Identity;
    const config = yield* InstanceConfig;
    if (config.setupToken === null || (yield* promise(() => records.users.count())) > 0) {
      return yield* Effect.fail(new SetupClosed());
    }
    if (!constantTimeEqual(input.token, config.setupToken))
      return yield* Effect.fail(new SetupTokenInvalid());
    if (input.name.trim() === "" || input.name.length > 100)
      return yield* Effect.fail(new InvalidInput({ field: "name" }));
    if (!EMAIL.test(input.email) || input.email.length > 254)
      return yield* Effect.fail(new InvalidInput({ field: "email" }));
    if (input.password.length < 12 || input.password.length > 128) {
      return yield* Effect.fail(new InvalidInput({ field: "password" }));
    }
    const user = yield* promise(() =>
      identity.createAdmin({
        name: input.name.trim(),
        email: input.email,
        password: input.password,
      }),
    );
    const backends = yield* promise(() => records.backends.list());
    let backendId = backends[0]?.id;
    if (backendId === undefined) {
      const id = crypto.randomUUID();
      backendId = id;
      let chosen = config.defaultBackend ?? {
        kind: config.storageKinds[0] ?? "durable-object",
        config: {},
        secretKey: null,
      };
      // The deployment's own S3 settings are checked like any other; an invalid one is stored as
      // it is and shows as unavailable, so setup still completes and the admin can fix it.
      const checked = chosen.kind === "s3" ? checkS3Config(chosen.config) : null;
      if (checked?.ok) chosen = { ...chosen, config: checked.config };
      const cipher = yield* CredentialCipher;
      const secret = chosen.secretKey;
      const sealed = secret ? yield* cipher.seal(id, secret) : null;
      yield* insert(() =>
        records.backends.create({
          id,
          name: "Default",
          kind: chosen.kind,
          config: chosen.config,
          ...(sealed === null ? {} : { secretKey: sealed }),
        }),
      );
    }
    const mounts = yield* promise(() => records.mounts.list());
    if (mounts.length === 0) {
      yield* insert(() =>
        records.mounts.create({
          id: crypto.randomUUID(),
          name: DEFAULT_MOUNT,
          backendId: backendId ?? "",
          root: "",
        }),
      );
    }
    return { userId: user.id };
  });

/** The signed-in administrator, or Unauthorized. */
export const requireUser = (headers: Headers) =>
  Effect.gen(function* () {
    const identity = yield* Identity;
    const user = yield* promise(() => identity.sessionUser(headers));
    return user ?? (yield* Effect.fail(new Unauthorized()));
  });

// --- API Keys ------------------------------------------------------------------------------

export interface KeyView {
  readonly id: string;
  readonly name: string;
  readonly start: string | null;
  readonly access: Access;
  /** The roots the key is limited to; null for every Mount, empty when its scope cannot be read. */
  readonly paths: readonly string[] | null;
  readonly enabled: boolean;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  /** When a WebDAV client last signed in with it, to within a few minutes; null for never. */
  readonly lastUsedAt: string | null;
}

const accessOf = (metadata: unknown): Access =>
  typeof metadata === "object" &&
  metadata !== null &&
  "access" in metadata &&
  metadata.access === "read-write"
    ? "read-write"
    : "read-only";

/** The roots a key's metadata names; null for every Mount, and for metadata that names none. */
const scopeOf = (metadata: unknown): Scope =>
  typeof metadata === "object" && metadata !== null && "paths" in metadata
    ? parseScope(metadata.paths)
    : null;

/**
 * Whether stored metadata cannot be trusted to say what a key reaches: text that is not JSON, or a
 * `paths` that is not a list of roots. Such a key reaches nothing rather than everything.
 */
const brokenScope = (metadata: unknown): boolean =>
  typeof metadata === "string" ||
  (typeof metadata === "object" &&
    metadata !== null &&
    "paths" in metadata &&
    metadata.paths !== undefined &&
    parseScope(metadata.paths) === null);

const keyView = (key: ApiKeyRecord): KeyView => ({
  id: key.id,
  name: key.name ?? "",
  start: key.start,
  access: accessOf(key.metadata),
  paths: brokenScope(key.metadata) ? [] : (scopeOf(key.metadata)?.map(formatRoot) ?? null),
  enabled: key.enabled,
  expiresAt: key.expiresAt?.toISOString() ?? null,
  createdAt: key.createdAt.toISOString(),
  lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
});

export const listKeys = Effect.gen(function* () {
  const records = yield* Records;
  return (yield* promise(() => records.apiKeys.list())).map(keyView);
});

const MAX_KEY_DAYS = 3650;

export const createKey = (
  userId: string,
  input: { name: string; access: string; expiresInDays: number | null; paths?: unknown },
) =>
  Effect.gen(function* () {
    const identity = yield* Identity;
    const name = input.name.trim();
    if (name === "" || name.length > 64)
      return yield* Effect.fail(new InvalidInput({ field: "name" }));
    if (input.access !== "read-only" && input.access !== "read-write") {
      return yield* Effect.fail(new InvalidInput({ field: "access" }));
    }
    const days = input.expiresInDays;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > MAX_KEY_DAYS)) {
      return yield* Effect.fail(new InvalidInput({ field: "expiresInDays" }));
    }
    const scope =
      input.paths === undefined || input.paths === null ? null : parseScope(input.paths);
    if (input.paths !== undefined && input.paths !== null && scope === null) {
      return yield* Effect.fail(new InvalidInput({ field: "paths" }));
    }
    if (scope !== null) {
      // A key names its Mounts by name, so each must exist: a key made for a name no Mount has yet
      // would reach whichever Mount takes that name later.
      const records = yield* Records;
      const names = new Set(
        (yield* promise(() => records.mounts.list())).map((mount) => mount.name),
      );
      if (scope.some((root) => !names.has(root[0] ?? ""))) {
        return yield* Effect.fail(new InvalidInput({ field: "paths" }));
      }
    }
    const access: Access = input.access === "read-write" ? "read-write" : "read-only";
    const created = yield* promise(() =>
      identity.createApiKey({
        userId,
        name,
        expiresIn: days === null ? null : days * 86_400,
        metadata: scope === null ? { access } : { access, paths: scope.map(formatRoot) },
      }),
    );
    return { id: created.id, key: created.key };
  });

/** Renames a key, as the admin tells keys apart; its secret, access and scope stay as they are. */
export const renameKey = (id: string, input: { name: string }) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const name = input.name.trim();
    if (name === "" || name.length > 64)
      return yield* Effect.fail(new InvalidInput({ field: "name" }));
    if (!(yield* promise(() => records.apiKeys.rename(id, name))))
      return yield* Effect.fail(new NotFound());
    return { id, name };
  });

export const revokeKey = (id: string) =>
  Effect.gen(function* () {
    const records = yield* Records;
    if (!(yield* promise(() => records.apiKeys.remove(id))))
      return yield* Effect.fail(new NotFound());
    return { id };
  });

// --- Backends and Mounts -------------------------------------------------------------------

/**
 * How a backend answered when the list was read: in how many milliseconds, or what went wrong. A
 * backend this runtime cannot open, for its kind or its saved settings, was never asked.
 */
export type BackendStatus =
  | { readonly state: "answered"; readonly ms: number }
  | { readonly state: "failed"; readonly failure: StorageFailure; readonly ms: number }
  | { readonly state: "not-opened" };

const backendStatusOf = (usage: StorageResult<Usage> | null, ms: number): BackendStatus =>
  usage === null
    ? { state: "not-opened" }
    : usage.ok
      ? { state: "answered", ms }
      : { state: "failed", failure: usage.failure, ms };

export const listBackends = Effect.gen(function* () {
  const records = yield* Records;
  const opener = yield* StorageOpener;
  const backends = yield* promise(() => records.backends.list());
  return yield* Effect.forEach(backends, (backend) =>
    Effect.gen(function* () {
      const storage = opener.open(backend);
      const started = Date.now();
      const usage = storage
        ? yield* promise(() =>
            storage
              .usage()
              .catch((): StorageResult<Usage> => ({ ok: false, failure: "unavailable" })),
          )
        : null;
      return {
        id: backend.id,
        name: backend.name,
        kind: backend.kind,
        createdAt: backend.createdAt.toISOString(),
        available: usage?.ok === true,
        usage: usage?.ok ? usage.value : null,
        status: backendStatusOf(usage, Date.now() - started),
      };
    }),
  );
});

export const createBackend = (input: {
  name: string;
  kind: string;
  config?: unknown;
  secretKey?: string;
}) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const config = yield* InstanceConfig;
    const name = input.name.trim();
    if (name === "" || name.length > 64)
      return yield* Effect.fail(new InvalidInput({ field: "name" }));
    if (!config.storageKinds.includes(input.kind))
      return yield* Effect.fail(new InvalidInput({ field: "kind" }));
    const id = crypto.randomUUID();
    if (input.kind === "s3") {
      const checked = checkS3Config(input.config);
      if (!checked.ok) return yield* Effect.fail(new InvalidInput({ field: checked.field }));
      const secret = input.secretKey ?? "";
      if (secret === "" || secret.length > 256) {
        return yield* Effect.fail(new InvalidInput({ field: "secretKey" }));
      }
      const cipher = yield* CredentialCipher;
      const sealed = yield* cipher.seal(id, Redacted.make(secret));
      yield* insert(() =>
        records.backends.create({
          id,
          name,
          kind: "s3",
          config: checked.config,
          secretKey: sealed,
        }),
      );
      return { id };
    }
    if (input.kind === "r2") {
      const checked = checkR2Config(input.config);
      if (!checked.ok) return yield* Effect.fail(new InvalidInput({ field: checked.field }));
      yield* insert(() =>
        records.backends.create({ id, name, kind: "r2", config: checked.config }),
      );
      return { id };
    }
    yield* insert(() => records.backends.create({ id, name, kind: input.kind, config: {} }));
    return { id };
  });

const parseRoot = (root: string): Path | null => {
  const names = root.split("/").filter((name) => name !== "");
  return isValidPath(names) ? names : null;
};

export const listMounts = Effect.gen(function* () {
  const records = yield* Records;
  return (yield* promise(() => records.mounts.list())).map((mount) => ({
    id: mount.id,
    name: mount.name,
    backendId: mount.backendId,
    backendKind: mount.backendKind,
    root: mount.root,
    createdAt: mount.createdAt.toISOString(),
  }));
});

/** The backend and root a Mount may publish: the backend exists and the root is a collection. */
const checkTarget = (input: { backendId: string; root: string }) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const opener = yield* StorageOpener;
    const root = parseRoot(input.root);
    if (root === null) return yield* Effect.fail(new InvalidInput({ field: "root" }));
    const backend = (yield* promise(() => records.backends.list())).find(
      (b) => b.id === input.backendId,
    );
    if (!backend) return yield* Effect.fail(new InvalidInput({ field: "backendId" }));
    if (root.length > 0) {
      // A Mount of a path inside a backend needs the collection to exist.
      const storage = opener.open(backend);
      const entry = storage ? yield* promise(() => storage.stat(root)) : null;
      if (!entry?.ok || entry.value.kind !== "collection")
        return yield* Effect.fail(new InvalidInput({ field: "root" }));
    }
    return { backendId: backend.id, root: root.join("/") };
  });

/**
 * Points a Mount at another backend or path, as the last step of moving its files there. The
 * Mount keeps its name, so the API Keys limited to it keep reaching it.
 */
export const retargetMount = (id: string, input: { backendId: string; root: string }) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const target = yield* checkTarget(input);
    if (!(yield* promise(() => records.mounts.retarget(id, target.backendId, target.root))))
      return yield* Effect.fail(new NotFound());
    return { id };
  });

export const createMount = (input: { name: string; backendId: string; root: string }) =>
  Effect.gen(function* () {
    const records = yield* Records;
    if (!isValidName(input.name) || input.name.length > 64)
      return yield* Effect.fail(new InvalidInput({ field: "name" }));
    const target = yield* checkTarget(input);
    const id = crypto.randomUUID();
    yield* insert(() => records.mounts.create({ id, name: input.name, ...target }));
    return { id };
  });

/**
 * Fails with MountInUse when an API Key is limited to the Mount, since a key names its Mounts by
 * name: renaming or removing the Mount would leave the key reaching whatever Mount takes the name.
 */
const ensureNoKeyLimitedTo = (id: string) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const mount = (yield* promise(() => records.mounts.list())).find((m) => m.id === id);
    if (!mount) return;
    const keys = yield* promise(() => records.apiKeys.list());
    const limited = keys.some(
      (key) =>
        brokenScope(key.metadata) ||
        (scopeOf(key.metadata) ?? []).some((root) => root[0] === mount.name),
    );
    if (limited) yield* Effect.fail(new MountInUse());
  });

export const renameMount = (id: string, name: string) =>
  Effect.gen(function* () {
    const records = yield* Records;
    if (!isValidName(name) || name.length > 64)
      return yield* Effect.fail(new InvalidInput({ field: "name" }));
    yield* ensureNoKeyLimitedTo(id);
    const renamed = yield* Effect.tryPromise({
      try: () => records.mounts.rename(id, name),
      catch: (e) => e,
    }).pipe(
      Effect.catch((error) => (isUnique(error) ? Effect.fail(new NameTaken()) : Effect.die(error))),
    );
    if (!renamed) return yield* Effect.fail(new NotFound());
    return { id };
  });

export const removeMount = (id: string) =>
  Effect.gen(function* () {
    const records = yield* Records;
    yield* ensureNoKeyLimitedTo(id);
    if (!(yield* promise(() => records.mounts.remove(id))))
      return yield* Effect.fail(new NotFound());
    return { id };
  });

/** The WebDAV namespace: every Mount whose backend this runtime can open. */
export const openNamespace = Effect.gen(function* () {
  const records = yield* Records;
  const opener = yield* StorageOpener;
  const mounts: Mount[] = [];
  const backends = new Map((yield* promise(() => records.backends.list())).map((b) => [b.id, b]));
  for (const record of yield* promise(() => records.mounts.list())) {
    const stored = backends.get(record.backendId) ?? {
      id: record.backendId,
      name: "",
      kind: record.backendKind,
      config: {},
      secretKey: null,
      createdAt: new Date(0),
    };
    const backend = opener.open(stored);
    if (backend) {
      mounts.push({
        name: record.name,
        backendId: record.backendId,
        backend,
        root: parseRoot(record.root) ?? [],
      });
    }
  }
  return createMountedStorage(mounts);
});

export const instanceUsage = Effect.gen(function* () {
  const storage = yield* openNamespace;
  const usage = yield* promise(() => storage.usage());
  return usage.ok ? usage.value : ({ files: 0, collections: 0, bytes: 0 } satisfies Usage);
});

// --- WebDAV credentials --------------------------------------------------------------------

/** How Better Auth stores a key: base64url of its SHA-256, without padding. */
export const hashApiKey = async (key: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export interface Credential {
  readonly keyId: string;
  readonly access: Access;
  /** The roots the key is limited to; null for every Mount. */
  readonly scope: Scope;
}

/**
 * How stale a key's last use may get before a sign-in records it again. Each record is a database
 * write, and Workers Free allows 100,000 a day, so a busy client writes at most once per key in
 * this time rather than once per request.
 */
export const USE_RECORD_INTERVAL_MS = 5 * 60_000;

/** Whether a sign-in at `now` records the key's use: never recorded, or recorded long enough ago. */
export const shouldRecordUse = (lastUsedAt: Date | null, now: number): boolean =>
  lastUsedAt === null || now - lastUsedAt.getTime() >= USE_RECORD_INTERVAL_MS;

/** Checks an API Key sent as the password of Basic Auth; null when it is unknown, off or expired. */
export const verifyApiKey = (key: string, now: number) =>
  Effect.gen(function* () {
    const records = yield* Records;
    if (key.length < 16 || key.length > 256) return null;
    const hash = yield* promise(() => hashApiKey(key));
    const record = yield* promise(() => records.apiKeys.findByHash(hash));
    if (
      !record ||
      !record.enabled ||
      (record.expiresAt !== null && record.expiresAt.getTime() <= now)
    )
      return null;
    if (brokenScope(record.metadata)) return null;
    if (shouldRecordUse(record.lastUsedAt, now)) {
      // The sign-in stands whether or not the record is written.
      yield* promise(() =>
        records.apiKeys.recordUse(record.id, new Date(now)).catch((error: unknown) => {
          console.error("Could not record the use of an API Key:", error);
        }),
      );
    }
    return {
      keyId: record.id,
      access: accessOf(record.metadata),
      scope: scopeOf(record.metadata),
    } satisfies Credential;
  });

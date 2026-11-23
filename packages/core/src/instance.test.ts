import { Cause, Context, Effect, Exit, Layer, Option, Redacted } from "effect";
import { CredentialCipher } from "./credentials";
import { describe, expect, it } from "vitest";
import {
  completeSetup,
  createBackend,
  createKey,
  createMount,
  DEFAULT_MOUNT,
  hashApiKey,
  Identity,
  InstanceConfig,
  instanceUsage,
  listBackends,
  listKeys,
  listMounts,
  openNamespace,
  Records,
  removeMount,
  renameMount,
  requireUser,
  revokeKey,
  setupStatus,
  StorageOpener,
  verifyApiKey,
  type ApiKeyRecord,
  type BackendRecord,
  type MountRecord,
} from "./instance";
import { createMemoryStorage } from "./memory-storage";
import { fail, type StorageBackend, type Usage } from "./storage";

// The application services against fake Ports: an in-memory record store, an identity provider
// that records what it is asked, and a storage opener that serves memory backends by id.

type RecordsShape = Context.Service.Shape<typeof Records>;
type IdentityShape = Context.Service.Shape<typeof Identity>;
type Services = Records | Identity | StorageOpener | InstanceConfig | CredentialCipher;

const CREATED = new Date("2026-01-02T03:04:05.000Z");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = "setup-token-0123456789";
const ADMIN = { name: "Admin", email: "admin@davloom.test", password: "a".repeat(12) };

interface WorldOptions {
  readonly users?: number;
  readonly setupToken?: string | null;
  readonly storageKinds?: readonly string[];
  readonly defaultBackend?: {
    kind: string;
    config: unknown;
    secretKey: Redacted.Redacted | null;
  } | null;
  readonly backends?: BackendRecord[];
  readonly mounts?: MountRecord[];
  readonly keys?: ApiKeyRecord[];
  readonly keysByHash?: Record<string, ApiKeyRecord>;
  readonly storages?: Record<string, StorageBackend | null>;
  readonly sessionUser?: { id: string; name: string; email: string } | null;
  readonly records?: Partial<{
    backends: Partial<RecordsShape["backends"]>;
    mounts: Partial<RecordsShape["mounts"]>;
    apiKeys: Partial<RecordsShape["apiKeys"]>;
  }>;
}

const makeWorld = (options: WorldOptions = {}) => {
  const backends = [...(options.backends ?? [])];
  const mounts = [...(options.mounts ?? [])];
  const calls = {
    backendCreates: [] as Parameters<RecordsShape["backends"]["create"]>[0][],
    mountCreates: [] as Parameters<RecordsShape["mounts"]["create"]>[0][],
    renames: [] as [string, string][],
    keyRemoves: [] as string[],
    hashLookups: [] as string[],
    admins: [] as Parameters<IdentityShape["createAdmin"]>[0][],
    apiKeys: [] as Parameters<IdentityShape["createApiKey"]>[0][],
    sessionHeaders: [] as Headers[],
  };
  const records: RecordsShape = {
    users: { count: () => Promise.resolve(options.users ?? 0) },
    backends: {
      list: () => Promise.resolve([...backends]),
      create: (record) => {
        calls.backendCreates.push(record);
        backends.push({
          id: record.id,
          name: record.name,
          kind: record.kind,
          config: record.config,
          secretKey: record.secretKey ?? null,
          createdAt: CREATED,
        });
        return Promise.resolve();
      },
      ...options.records?.backends,
    },
    mounts: {
      list: () => Promise.resolve([...mounts]),
      create: (record) => {
        calls.mountCreates.push(record);
        return Promise.resolve();
      },
      rename: (id, name) => {
        calls.renames.push([id, name]);
        return Promise.resolve(mounts.some((mount) => mount.id === id));
      },
      remove: (id) => Promise.resolve(mounts.some((mount) => mount.id === id)),
      ...options.records?.mounts,
    },
    apiKeys: {
      findByHash: (hash) => {
        calls.hashLookups.push(hash);
        return Promise.resolve(options.keysByHash?.[hash] ?? null);
      },
      list: () => Promise.resolve([...(options.keys ?? [])]),
      remove: (id) => {
        calls.keyRemoves.push(id);
        return Promise.resolve((options.keys ?? []).some((key) => key.id === id));
      },
      ...options.records?.apiKeys,
    },
  };
  const identity: IdentityShape = {
    createAdmin: (details) => {
      calls.admins.push(details);
      return Promise.resolve({ id: "user-1" });
    },
    sessionUser: (headers) => {
      calls.sessionHeaders.push(headers);
      return Promise.resolve(options.sessionUser ?? null);
    },
    createApiKey: (details) => {
      calls.apiKeys.push(details);
      return Promise.resolve({ id: "key-1", key: "dav_secret" });
    },
  };
  const layer = Layer.mergeAll(
    Layer.succeed(Records, records),
    Layer.succeed(Identity, identity),
    Layer.succeed(StorageOpener, {
      open: (backend: { id: string; kind: string }) => options.storages?.[backend.id] ?? null,
    }),
    Layer.succeed(CredentialCipher, {
      seal: (id: string, secret: Redacted.Redacted) =>
        Effect.succeed(`sealed:${id}:${Redacted.value(secret)}`),
      open: (_id: string, sealed: string) => Effect.succeed(Redacted.make(sealed)),
    }),
    Layer.succeed(InstanceConfig, {
      setupToken: options.setupToken === undefined ? TOKEN : options.setupToken,
      storageKinds: options.storageKinds ?? ["durable-object", "s3"],
      defaultBackend: options.defaultBackend ?? null,
    }),
  );
  const run = <A, E>(program: Effect.Effect<A, E, Services>) =>
    Effect.runPromiseExit(Effect.provide(program, layer));
  return { run, calls };
};

const valueOf = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (!Exit.isSuccess(exit)) throw new Error(`expected success, got ${Cause.pretty(exit.cause)}`);
  return exit.value;
};

const errorOf = <A, E>(exit: Exit.Exit<A, E>): E | undefined => {
  if (Exit.isSuccess(exit)) return undefined;
  const failure = Cause.findErrorOption(exit.cause);
  return Option.isSome(failure) ? failure.value : undefined;
};

/** Whether the program died with a defect instead of failing with a declared error. */
const isDefect = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) && Option.isNone(Cause.findErrorOption(exit.cause));

const backend = (id: string, kind = "durable-object"): BackendRecord => ({
  id,
  name: `Backend ${id}`,
  kind,
  config: {},
  secretKey: null,
  createdAt: CREATED,
});

const mount = (id: string, name: string, backendId: string, root = ""): MountRecord => ({
  id,
  name,
  backendId,
  backendKind: "durable-object",
  root,
  createdAt: CREATED,
});

const apiKey = (overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord => ({
  id: "key-1",
  name: "Laptop",
  start: "dav_abcdef",
  enabled: true,
  expiresAt: null,
  createdAt: CREATED,
  metadata: { access: "read-write" },
  ...overrides,
});

/** A memory backend holding a collection `docs` with a file `docs/a.txt`, and a file `note.txt`. */
const seededStorage = async () => {
  const storage = createMemoryStorage();
  await storage.createCollection(["docs"]);
  await storage.write(["docs", "a.txt"], new Blob(["hello"]).stream(), {});
  await storage.write(["note.txt"], new Blob(["abc"]).stream(), {});
  return storage;
};

const uniqueError = new Error("UNIQUE constraint failed: mounts.name");
const nestedUniqueError = new Error("D1_ERROR: query failed", { cause: uniqueError });

describe("setupStatus", () => {
  it.each([
    [0, TOKEN, { needed: true, open: true }],
    [0, null, { needed: true, open: false }],
    [1, TOKEN, { needed: false, open: false }],
    [2, null, { needed: false, open: false }],
  ])("with %i users and token %j is %j", async (users, setupToken, expected) => {
    const { run } = makeWorld({ users, setupToken });

    expect(valueOf(await run(setupStatus))).toEqual(expected);
  });
});

describe("completeSetup", () => {
  const input = { ...ADMIN, token: TOKEN };

  it.each([
    ["no setup token is configured", { setupToken: null }, input],
    ["a user already exists", { users: 1 }, input],
    ["a user exists, even with a wrong token", { users: 1 }, { ...input, token: "wrong" }],
  ])("is closed when %s", async (_case, options: WorldOptions, details) => {
    const { run, calls } = makeWorld(options);

    expect(errorOf(await run(completeSetup(details)))?._tag).toBe("SetupClosed");
    expect(calls.admins).toEqual([]);
  });

  it.each([
    ["a different token of the same length", TOKEN.replace("0", "1")],
    ["a shorter token", TOKEN.slice(0, -1)],
    ["a longer token", `${TOKEN}x`],
    ["an empty token", ""],
  ])("rejects %s", async (_case, token) => {
    const { run, calls } = makeWorld();

    expect(errorOf(await run(completeSetup({ ...input, token })))?._tag).toBe("SetupTokenInvalid");
    expect(calls.admins).toEqual([]);
  });

  it.each([
    ["name", { name: "" }],
    ["name", { name: "   " }],
    ["name", { name: "n".repeat(101) }],
    ["email", { email: "admin" }],
    ["email", { email: "admin@" }],
    ["email", { email: "@davloom.test" }],
    ["email", { email: "ad min@davloom.test" }],
    ["email", { email: `${"a".repeat(242)}@davloom.test` }],
    ["password", { password: "a".repeat(11) }],
    ["password", { password: "a".repeat(129) }],
  ])("rejects an invalid %s (%j)", async (field, change) => {
    const { run, calls } = makeWorld();
    const error = errorOf(await run(completeSetup({ ...input, ...change })));

    expect(error).toMatchObject({ _tag: "InvalidInput", field });
    expect(calls.admins).toEqual([]);
  });

  it.each([
    ["a 100 character name", { name: "n".repeat(100) }],
    ["a 254 character email", { email: `${"a".repeat(241)}@davloom.test` }],
    ["a 12 character password", { password: "p".repeat(12) }],
    ["a 128 character password", { password: "p".repeat(128) }],
  ])("accepts %s", async (_case, change) => {
    const { run } = makeWorld();

    expect(valueOf(await run(completeSetup({ ...input, ...change })))).toEqual({
      userId: "user-1",
    });
  });

  it("creates the administrator with a trimmed name, a default backend and its Mount", async () => {
    const { run, calls } = makeWorld({ storageKinds: ["s3", "durable-object"] });

    const result = valueOf(await run(completeSetup({ ...input, name: "  Admin  " })));

    expect(result).toEqual({ userId: "user-1" });
    expect(calls.admins).toEqual([{ name: "Admin", email: ADMIN.email, password: ADMIN.password }]);
    expect(calls.backendCreates).toEqual([
      { id: expect.stringMatching(UUID), name: "Default", kind: "s3", config: {} },
    ]);
    expect(calls.mountCreates).toEqual([
      {
        id: expect.stringMatching(UUID),
        name: DEFAULT_MOUNT,
        backendId: calls.backendCreates[0]?.id,
        root: "",
      },
    ]);
    expect(DEFAULT_MOUNT).toBe("files");
  });

  it("falls back to durable-object storage when the runtime names no storage kind", async () => {
    const { run, calls } = makeWorld({ storageKinds: [] });

    valueOf(await run(completeSetup(input)));

    expect(calls.backendCreates.map((record) => record.kind)).toEqual(["durable-object"]);
  });

  it("mounts the first existing backend instead of creating one", async () => {
    const { run, calls } = makeWorld({ backends: [backend("b-1"), backend("b-2")] });

    valueOf(await run(completeSetup(input)));

    expect(calls.backendCreates).toEqual([]);
    expect(calls.mountCreates.map((record) => record.backendId)).toEqual(["b-1"]);
  });

  it("creates no Mount when one already exists", async () => {
    const { run, calls } = makeWorld({
      backends: [backend("b-1")],
      mounts: [mount("m-1", "files", "b-1")],
    });

    valueOf(await run(completeSetup(input)));

    expect(calls.backendCreates).toEqual([]);
    expect(calls.mountCreates).toEqual([]);
  });

  it.each([
    ["a unique violation", uniqueError],
    ["a unique violation nested as the cause", nestedUniqueError],
  ])("turns %s on the default backend into NameTaken", async (_case, error) => {
    const { run } = makeWorld({ records: { backends: { create: () => Promise.reject(error) } } });

    expect(errorOf(await run(completeSetup(input)))?._tag).toBe("NameTaken");
  });

  it.each([
    ["a unique violation", uniqueError],
    ["a unique violation nested as the cause", nestedUniqueError],
  ])("turns %s on the default Mount into NameTaken", async (_case, error) => {
    const { run } = makeWorld({ records: { mounts: { create: () => Promise.reject(error) } } });

    expect(errorOf(await run(completeSetup(input)))?._tag).toBe("NameTaken");
  });

  it("lets any other insert failure through as a defect", async () => {
    const { run } = makeWorld({
      records: { mounts: { create: () => Promise.reject(new Error("disk I/O error")) } },
    });

    expect(isDefect(await run(completeSetup(input)))).toBe(true);
  });
});

describe("requireUser", () => {
  it("returns the signed-in user of the request", async () => {
    const user = { id: "user-1", name: "Admin", email: ADMIN.email };
    const { run, calls } = makeWorld({ sessionUser: user });
    const headers = new Headers({ cookie: "session=1" });

    expect(valueOf(await run(requireUser(headers)))).toEqual(user);
    expect(calls.sessionHeaders).toEqual([headers]);
  });

  it("fails with Unauthorized without a session", async () => {
    const { run } = makeWorld({ sessionUser: null });

    expect(errorOf(await run(requireUser(new Headers())))?._tag).toBe("Unauthorized");
  });
});

describe("listKeys", () => {
  it("shows each key without its secret", async () => {
    const expiresAt = new Date("2027-05-06T07:08:09.000Z");
    const { run } = makeWorld({
      keys: [
        apiKey({ expiresAt }),
        apiKey({ id: "key-2", name: null, start: null, enabled: false, metadata: null }),
      ],
    });

    expect(valueOf(await run(listKeys))).toEqual([
      {
        id: "key-1",
        name: "Laptop",
        start: "dav_abcdef",
        access: "read-write",
        paths: null,
        enabled: true,
        expiresAt: "2027-05-06T07:08:09.000Z",
        createdAt: "2026-01-02T03:04:05.000Z",
      },
      {
        id: "key-2",
        name: "",
        start: null,
        access: "read-only",
        paths: null,
        enabled: false,
        expiresAt: null,
        createdAt: "2026-01-02T03:04:05.000Z",
      },
    ]);
  });

  it.each([
    [{ access: "read-write" }, "read-write"],
    [{ access: "read-write", other: 1 }, "read-write"],
    [{ access: "read-only" }, "read-only"],
    [{ access: "READ-WRITE" }, "read-only"],
    [{ access: true }, "read-only"],
    [{}, "read-only"],
    [[], "read-only"],
    ["read-write", "read-only"],
    [1, "read-only"],
    [null, "read-only"],
    [undefined, "read-only"],
  ])("reads metadata %j as %s access", async (metadata, access) => {
    const { run } = makeWorld({ keys: [apiKey({ metadata })] });

    expect(valueOf(await run(listKeys))[0]?.access).toBe(access);
  });
});

describe("createKey", () => {
  const input = { name: "Laptop", access: "read-only", expiresInDays: null };

  it.each([
    ["name", { name: "" }],
    ["name", { name: "  " }],
    ["name", { name: "k".repeat(65) }],
    ["access", { access: "admin" }],
    ["access", { access: "" }],
    ["access", { access: "Read-Write" }],
    ["expiresInDays", { expiresInDays: 0 }],
    ["expiresInDays", { expiresInDays: -1 }],
    ["expiresInDays", { expiresInDays: 3651 }],
    ["expiresInDays", { expiresInDays: 1.5 }],
    ["expiresInDays", { expiresInDays: Number.NaN }],
    ["expiresInDays", { expiresInDays: Number.POSITIVE_INFINITY }],
  ])("rejects an invalid %s (%j)", async (field, change) => {
    const { run, calls } = makeWorld();
    const error = errorOf(await run(createKey("user-1", { ...input, ...change })));

    expect(error).toMatchObject({ _tag: "InvalidInput", field });
    expect(calls.apiKeys).toEqual([]);
  });

  it.each([
    [null, null],
    [1, 86_400],
    [30, 2_592_000],
    [3650, 315_360_000],
  ])("passes %j days to the identity provider as %j seconds", async (days, seconds) => {
    const { run, calls } = makeWorld();

    valueOf(await run(createKey("user-1", { ...input, expiresInDays: days })));

    expect(calls.apiKeys.map((details) => details.expiresIn)).toEqual([seconds]);
  });

  it.each([["read-only"], ["read-write"]])("stores %s access in the metadata", async (access) => {
    const { run, calls } = makeWorld();

    const result = valueOf(await run(createKey("user-1", { ...input, access })));

    expect(result).toEqual({ id: "key-1", key: "dav_secret" });
    expect(calls.apiKeys).toEqual([
      { userId: "user-1", name: "Laptop", expiresIn: null, metadata: { access } },
    ]);
  });

  it("trims the name and accepts 64 characters", async () => {
    const { run, calls } = makeWorld();
    const name = "k".repeat(64);

    valueOf(await run(createKey("user-1", { ...input, name: `  ${name} ` })));

    expect(calls.apiKeys.map((details) => details.name)).toEqual([name]);
  });
});

describe("revokeKey", () => {
  it("removes a known key", async () => {
    const { run, calls } = makeWorld({ keys: [apiKey()] });

    expect(valueOf(await run(revokeKey("key-1")))).toEqual({ id: "key-1" });
    expect(calls.keyRemoves).toEqual(["key-1"]);
  });

  it("fails with NotFound for an unknown key", async () => {
    const { run } = makeWorld({ keys: [apiKey()] });

    expect(errorOf(await run(revokeKey("key-9")))?._tag).toBe("NotFound");
  });
});

describe("listBackends", () => {
  it("reports each backend's availability and usage", async () => {
    const storage = await seededStorage();
    const failing: StorageBackend = {
      ...createMemoryStorage(),
      usage: () => Promise.resolve(fail<Usage>("unavailable")),
    };
    const { run } = makeWorld({
      backends: [backend("up"), backend("closed", "s3"), backend("down")],
      storages: { up: storage, closed: null, down: failing },
    });

    expect(valueOf(await run(listBackends))).toEqual([
      {
        id: "up",
        name: "Backend up",
        kind: "durable-object",
        createdAt: "2026-01-02T03:04:05.000Z",
        available: true,
        usage: { files: 2, collections: 1, bytes: 8 },
      },
      {
        id: "closed",
        name: "Backend closed",
        kind: "s3",
        createdAt: "2026-01-02T03:04:05.000Z",
        available: false,
        usage: null,
      },
      {
        id: "down",
        name: "Backend down",
        kind: "durable-object",
        createdAt: "2026-01-02T03:04:05.000Z",
        available: false,
        usage: null,
      },
    ]);
  });
});

describe("createBackend", () => {
  it.each([
    ["name", { name: "" }],
    ["name", { name: " \t " }],
    ["name", { name: "b".repeat(65) }],
    ["kind", { kind: "ftp" }],
    ["kind", { kind: "" }],
  ])("rejects an invalid %s (%j)", async (field, change) => {
    const { run, calls } = makeWorld();
    const error = errorOf(await run(createBackend({ name: "Photos", kind: "s3", ...change })));

    expect(error).toMatchObject({ _tag: "InvalidInput", field });
    expect(calls.backendCreates).toEqual([]);
  });

  it("creates a backend of a kind the runtime can open, with a trimmed name", async () => {
    const { run, calls } = makeWorld();

    const { id } = valueOf(
      await run(createBackend({ name: ` ${"b".repeat(64)} `, kind: "durable-object" })),
    );

    expect(id).toMatch(UUID);
    expect(calls.backendCreates).toEqual([
      { id, name: "b".repeat(64), kind: "durable-object", config: {} },
    ]);
  });

  it.each([
    ["a unique violation", uniqueError],
    ["a unique violation nested as the cause", nestedUniqueError],
  ])("turns %s into NameTaken", async (_case, error) => {
    const { run } = makeWorld({ records: { backends: { create: () => Promise.reject(error) } } });

    expect(
      errorOf(await run(createBackend({ name: "Photos", kind: "durable-object" })))?._tag,
    ).toBe("NameTaken");
  });
});

describe("listMounts", () => {
  it("shows each Mount with ISO timestamps", async () => {
    const { run } = makeWorld({ mounts: [mount("m-1", "files", "b-1", "docs/2026")] });

    expect(valueOf(await run(listMounts))).toEqual([
      {
        id: "m-1",
        name: "files",
        backendId: "b-1",
        backendKind: "durable-object",
        root: "docs/2026",
        createdAt: "2026-01-02T03:04:05.000Z",
      },
    ]);
  });
});

/** A world with backend `b-1`, which opens as a seeded memory backend. */
const withBackend = async (options: WorldOptions = {}) =>
  makeWorld({
    backends: [backend("b-1")],
    storages: { "b-1": await seededStorage() },
    ...options,
  });

describe("createMount", () => {
  it.each([
    ["name", { name: "" }],
    ["name", { name: "." }],
    ["name", { name: ".." }],
    ["name", { name: "a/b" }],
    ["name", { name: "nul\0" }],
    ["name", { name: "m".repeat(65) }],
    ["root", { root: "a/../b" }],
    ["root", { root: "./docs" }],
    ["root", { root: "missing" }],
    ["root", { root: "note.txt" }],
    ["root", { root: "docs/a.txt" }],
    ["backendId", { backendId: "b-9" }],
  ])("rejects an invalid %s (%j)", async (field, change) => {
    const { run, calls } = await withBackend();
    const error = errorOf(
      await run(createMount({ name: "photos", backendId: "b-1", root: "", ...change })),
    );

    expect(error).toMatchObject({ _tag: "InvalidInput", field });
    expect(calls.mountCreates).toEqual([]);
  });

  it("rejects a root in a backend the runtime cannot open", async () => {
    const { run } = makeWorld({ backends: [backend("b-1")], storages: { "b-1": null } });

    const exit = await run(createMount({ name: "photos", backendId: "b-1", root: "docs" }));

    expect(errorOf(exit)).toMatchObject({ _tag: "InvalidInput", field: "root" });
  });

  it.each([
    ["", ""],
    ["/", ""],
    ["docs", "docs"],
    ["/docs/", "docs"],
    ["//docs//", "docs"],
  ])("creates a Mount with root %j stored as %j", async (root, stored) => {
    const { run, calls } = await withBackend();

    const { id } = valueOf(await run(createMount({ name: "photos", backendId: "b-1", root })));

    expect(id).toMatch(UUID);
    expect(calls.mountCreates).toEqual([{ id, name: "photos", backendId: "b-1", root: stored }]);
  });

  it("mounts a backend's root without opening it", async () => {
    const { run, calls } = makeWorld({ backends: [backend("b-1")], storages: { "b-1": null } });

    valueOf(await run(createMount({ name: "m".repeat(64), backendId: "b-1", root: "" })));

    expect(calls.mountCreates).toHaveLength(1);
  });

  it.each([
    ["a unique violation", uniqueError],
    ["a unique violation nested as the cause", nestedUniqueError],
  ])("turns %s into NameTaken", async (_case, error) => {
    const { run } = await withBackend({
      records: { mounts: { create: () => Promise.reject(error) } },
    });

    const exit = await run(createMount({ name: "photos", backendId: "b-1", root: "" }));

    expect(errorOf(exit)?._tag).toBe("NameTaken");
  });
});

describe("renameMount", () => {
  it.each([[""], ["."], [".."], ["a/b"], ["m".repeat(65)]])(
    "rejects the invalid name %j",
    async (name) => {
      const { run, calls } = makeWorld({ mounts: [mount("m-1", "files", "b-1")] });

      expect(errorOf(await run(renameMount("m-1", name)))).toMatchObject({
        _tag: "InvalidInput",
        field: "name",
      });
      expect(calls.renames).toEqual([]);
    },
  );

  it("renames a known Mount", async () => {
    const { run, calls } = makeWorld({ mounts: [mount("m-1", "files", "b-1")] });

    expect(valueOf(await run(renameMount("m-1", "archive")))).toEqual({ id: "m-1" });
    expect(calls.renames).toEqual([["m-1", "archive"]]);
  });

  it("fails with NotFound for an unknown Mount", async () => {
    const { run } = makeWorld({ mounts: [mount("m-1", "files", "b-1")] });

    expect(errorOf(await run(renameMount("m-9", "archive")))?._tag).toBe("NotFound");
  });

  it.each([
    ["a unique violation", uniqueError],
    ["a unique violation nested as the cause", nestedUniqueError],
  ])("turns %s into NameTaken", async (_case, error) => {
    const { run } = makeWorld({ records: { mounts: { rename: () => Promise.reject(error) } } });

    expect(errorOf(await run(renameMount("m-1", "archive")))?._tag).toBe("NameTaken");
  });

  it.each([
    ["an unrelated error", new Error("database is locked")],
    ["a non-Error rejection", "UNIQUE constraint failed"],
  ])("lets %s through as a defect", async (_case, error) => {
    const { run } = makeWorld({ records: { mounts: { rename: () => Promise.reject(error) } } });

    expect(isDefect(await run(renameMount("m-1", "archive")))).toBe(true);
  });
});

describe("removeMount", () => {
  it.each([
    ["m-1", true],
    ["m-9", false],
  ])("removing %s succeeds: %s", async (id, succeeds) => {
    const { run } = makeWorld({ mounts: [mount("m-1", "files", "b-1")] });
    const exit = await run(removeMount(id));

    if (succeeds) expect(valueOf(exit)).toEqual({ id });
    else expect(errorOf(exit)?._tag).toBe("NotFound");
  });
});

describe("openNamespace", () => {
  it("publishes every Mount whose backend opens, each at its root", async () => {
    const storage = await seededStorage();
    const { run } = makeWorld({
      mounts: [
        mount("m-1", "whole", "b-1"),
        mount("m-2", "docs", "b-1", "docs"),
        mount("m-3", "closed", "b-2"),
        mount("m-4", "broken", "b-1", "x/../y"),
      ],
      storages: { "b-1": storage, "b-2": null },
    });

    const namespace = valueOf(await run(openNamespace));

    const names = await namespace.list([]);
    expect(names.ok && names.value.map((entry) => entry.path)).toEqual([
      ["whole"],
      ["docs"],
      ["broken"],
    ]);
    expect((await namespace.stat(["whole", "note.txt"])).ok).toBe(true);
    expect((await namespace.stat(["docs", "a.txt"])).ok).toBe(true);
    expect((await namespace.stat(["docs", "note.txt"])).ok).toBe(false);
    expect(await namespace.stat(["closed"])).toEqual({ ok: false, failure: "not-found" });
    // A stored root that is not a valid path falls back to the backend's root.
    expect((await namespace.stat(["broken", "note.txt"])).ok).toBe(true);
  });
});

describe("instanceUsage", () => {
  it("adds up the usage of every published backend once", async () => {
    const { run } = makeWorld({
      mounts: [
        mount("m-1", "a", "b-1"),
        mount("m-2", "b", "b-1", "docs"),
        mount("m-3", "c", "b-2"),
      ],
      storages: { "b-1": await seededStorage(), "b-2": await seededStorage() },
    });

    expect(valueOf(await run(instanceUsage))).toEqual({ files: 4, collections: 2, bytes: 16 });
  });

  it("reports zero when a backend cannot tell its usage", async () => {
    const failing: StorageBackend = {
      ...createMemoryStorage(),
      usage: () => Promise.resolve(fail<Usage>("unavailable")),
    };
    const { run } = makeWorld({
      mounts: [mount("m-1", "a", "b-1")],
      storages: { "b-1": failing },
    });

    expect(valueOf(await run(instanceUsage))).toEqual({ files: 0, collections: 0, bytes: 0 });
  });
});

describe("hashApiKey", () => {
  it("matches the published SHA-256 vector for abc in unpadded base64url", async () => {
    // FIPS 180-2: SHA-256("abc") = ba7816bf 8f01cfea 414140de 5dae2223 b00361a3 96177a9c b410ff61 f20015ad
    expect(await hashApiKey("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });

  // Expected values computed once with Bun's `new Bun.CryptoHasher("sha256").update(key)
  // .digest("base64url")`; core's tsconfig has no Bun types, since core also runs on workerd.
  it.each([
    ["", "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU"],
    ["dav_0123456789abcdef", "oOibRiVvkVbYq_OJB-nHtESun-Ah58mlbx02OeuGFWA"],
    ["dav_ÿ-é-漢字-🔑", "fR9jgXiqGOo9kr5_6PG0Itt2qm9KaFsk3A9yqeWbvGw"],
    ["x".repeat(256), "heYqzXUMTrVre2odZtylv6rF8GJgihqJNBDQKIk2wJo"],
    // The base64 of this digest holds both + and /, so the base64url alphabet matters.
    ["key-1", "vil0VGl443OebW2oXEvp8zTOMt8rn9S2_xtVwNV-nUQ"], // gitleaks:allow (a test digest)
  ])("hashes %j as %s", async (key, expected) => {
    const hash = await hashApiKey(key);

    expect(hash).toBe(expected);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("key scopes", () => {
  it("creates a key limited to its roots, written as the API shows them", async () => {
    const { run, calls } = makeWorld();
    valueOf(
      await run(
        createKey("user-1", {
          name: "k",
          access: "read-only",
          expiresInDays: null,
          paths: ["files//photos/", "/docs"],
        }),
      ),
    );
    expect(calls.apiKeys[0]?.metadata).toEqual({
      access: "read-only",
      paths: ["/files/photos", "/docs"],
    });
  });

  it.each([[[]], [["/"]], [["/a/.."]], ["/files"], [[1]]])(
    "refuses the scope %j",
    async (paths) => {
      const { run, calls } = makeWorld();
      const exit = await run(
        createKey("user-1", { name: "k", access: "read-only", expiresInDays: null, paths }),
      );
      expect(errorOf(exit)).toMatchObject({ _tag: "InvalidInput", field: "paths" });
      expect(calls.apiKeys).toEqual([]);
    },
  );

  it.each([[undefined], [null]])(
    "a key without a scope (%j) reaches every Mount",
    async (paths) => {
      const { run, calls } = makeWorld();
      valueOf(
        await run(
          createKey("user-1", { name: "k", access: "read-only", expiresInDays: null, paths }),
        ),
      );
      expect(calls.apiKeys[0]?.metadata).toEqual({ access: "read-only" });
    },
  );

  it("lists a key whose scope cannot be read as reaching nothing", async () => {
    const { run } = makeWorld({
      keys: [
        apiKey({ metadata: { access: "read-only", paths: "x" } }),
        apiKey({ id: "k-2", metadata: "{bad" }),
      ],
    });
    expect(valueOf(await run(listKeys)).map((key) => key.paths)).toEqual([[], []]);
  });

  it("lists a key's roots", async () => {
    const { run } = makeWorld({
      keys: [apiKey({ metadata: { access: "read-only", paths: ["/files/a"] } })],
    });
    expect(valueOf(await run(listKeys))[0]?.paths).toEqual(["/files/a"]);
  });

  it.each([
    [
      { access: "read-write", paths: ["/files/a"] },
      { keyId: "key-1", access: "read-write", scope: [["files", "a"]] },
    ],
    [{ access: "read-write", paths: null }, null],
    ["{not json", null],
    [{ access: "read-write" }, { keyId: "key-1", access: "read-write", scope: null }],
    [{ access: "read-write", paths: ["/"] }, null],
    [{ access: "read-write", paths: "files" }, null],
  ])("verifies a key with metadata %j as %j", async (metadata, expected) => {
    const KEY = "dav_scope_test_key_0123"; // gitleaks:allow (a made-up test key)
    const { run } = makeWorld({ keysByHash: { [await hashApiKey(KEY)]: apiKey({ metadata }) } });
    expect(valueOf(await run(verifyApiKey(KEY, Date.parse("2026-06-01T00:00:00Z"))))).toEqual(
      expected,
    );
  });
});

describe("verifyApiKey", () => {
  const KEY = "dav_0123456789abcdef"; // gitleaks:allow (a made-up test key)
  const NOW = Date.parse("2026-06-01T00:00:00.000Z");

  const worldWith = async (record: ApiKeyRecord) =>
    makeWorld({ keysByHash: { [await hashApiKey(KEY)]: record } });

  it.each([
    ["15 characters", "k".repeat(15)],
    ["257 characters", "k".repeat(257)],
    ["no characters", ""],
  ])("rejects a key of %s without a lookup", async (_case, key) => {
    const { run, calls } = makeWorld();

    expect(valueOf(await run(verifyApiKey(key, NOW)))).toBeNull();
    expect(calls.hashLookups).toEqual([]);
  });

  it.each([
    ["16 characters", "k".repeat(16), "7mMh11jMhfrF9q1Zg7vUrR3VlMVk_Mji9YlvCa_E1XQ"],
    ["256 characters", "k".repeat(256), "zhb-eCCKTpP3FY5iOTaA4CWyrVhPTodc6QOmVLt0z5M"],
  ])("looks up a key of %s by its hash", async (_case, key, hash) => {
    const { run, calls } = makeWorld();

    expect(valueOf(await run(verifyApiKey(key, NOW)))).toBeNull();
    expect(calls.hashLookups).toEqual([hash]);
  });

  it.each([
    ["read-write metadata", {}, { keyId: "key-1", access: "read-write", scope: null }],
    [
      "read-only metadata",
      { metadata: { access: "read-only" } },
      { keyId: "key-1", access: "read-only", scope: null },
    ],
    ["no metadata", { metadata: null }, { keyId: "key-1", access: "read-only", scope: null }],
    [
      "an expiry after now",
      { expiresAt: new Date(NOW + 1) },
      { keyId: "key-1", access: "read-write", scope: null },
    ],
    ["an expiry at now", { expiresAt: new Date(NOW) }, null],
    ["an expiry before now", { expiresAt: new Date(NOW - 1) }, null],
    ["a disabled key", { enabled: false }, null],
  ])("with %s returns %j", async (_case, overrides: Partial<ApiKeyRecord>, expected) => {
    const { run } = await worldWith(apiKey(overrides));

    expect(valueOf(await run(verifyApiKey(KEY, NOW)))).toEqual(expected);
  });

  it("returns null for an unknown key", async () => {
    const { run } = await worldWith(apiKey());

    expect(valueOf(await run(verifyApiKey(`${KEY}0`, NOW)))).toBeNull();
  });
});

describe("S3-compatible backends", () => {
  const s3 = {
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    bucket: "davloom",
    prefix: "dav",
    forcePathStyle: true,
    accessKeyId: "access",
  };

  it.each([
    [{ region: "" }, { region: "us-east-1" }],
    [{ prefix: "" }, { prefix: "" }],
    [{ prefix: "a/b/" }, { prefix: "a/b/" }],
    [{ forcePathStyle: undefined }, { forcePathStyle: true }],
    [{ forcePathStyle: false }, { forcePathStyle: false }],
    [{ endpoint: "https://s3.example.com/" }, { endpoint: "https://s3.example.com" }],
  ])("normalizes %j to %j", async (change, expected) => {
    const { run, calls } = makeWorld();
    valueOf(
      await run(
        createBackend({ name: "B", kind: "s3", config: { ...s3, ...change }, secretKey: "s" }),
      ),
    );
    expect(calls.backendCreates[0]?.config).toMatchObject(expected);
  });

  it("creates one with its configuration and a sealed secret key", async () => {
    const { run, calls } = makeWorld({
      sessionUser: { id: "u", name: "A", email: "a@example.com" },
    });
    const created = valueOf(
      await run(createBackend({ name: "Bucket", kind: "s3", config: s3, secretKey: "secret" })),
    );
    const record = calls.backendCreates[0];
    expect(record?.kind).toBe("s3");
    expect(record?.config).toEqual({ ...s3, prefix: "dav/" });
    expect(record?.secretKey).toBe(`sealed:${created.id}:secret`);
  });

  it.each([
    ["endpoint", { ...s3, endpoint: "ftp://x" }, "secret"],
    ["endpoint", { ...s3, endpoint: "not a url" }, "secret"],
    ["endpoint", { ...s3, endpoint: "https://user:pw@example.com" }, "secret"],
    ["region", { ...s3, region: "US EAST" }, "secret"],
    ["bucket", { ...s3, bucket: "Bad_Bucket" }, "secret"],
    ["bucket", { ...s3, bucket: "ab" }, "secret"],
    ["prefix", { ...s3, prefix: "/abs" }, "secret"],
    ["prefix", { ...s3, prefix: "a//b" }, "secret"],
    ["forcePathStyle", { ...s3, forcePathStyle: "yes" }, "secret"],
    ["accessKeyId", { ...s3, accessKeyId: "" }, "secret"],
    ["secretKey", s3, ""],
    ["secretKey", s3, "x".repeat(257)],
    ["secretKey", s3, undefined],
    ["region", { ...s3, region: "r".repeat(65) }, "secret"],
    ["prefix", { ...s3, prefix: "p".repeat(101) }, "secret"],
    ["accessKeyId", { ...s3, accessKeyId: "a".repeat(257) }, "secret"],
    ["endpoint", null, "secret"],
  ])("refuses an invalid %s", async (field, config, secretKey) => {
    const { run, calls } = makeWorld();
    const exit = await run(createBackend({ name: "Bucket", kind: "s3", config, secretKey }));
    expect(errorOf(exit)).toEqual(expect.objectContaining({ _tag: "InvalidInput", field }));
    expect(calls.backendCreates).toEqual([]);
  });

  it("setup stores the deployment's default S3 configuration normalized, or as it is when invalid", async () => {
    const valid = makeWorld({
      defaultBackend: { kind: "s3", config: { ...s3, prefix: "p" }, secretKey: null },
    });
    valueOf(
      await valid.run(
        completeSetup({
          name: "A",
          email: "a@example.com",
          password: "long enough pass",
          token: TOKEN,
        }),
      ),
    );
    expect(valid.calls.backendCreates[0]?.config).toMatchObject({ prefix: "p/" });
    expect(valid.calls.backendCreates[0]?.secretKey).toBeUndefined();
    const invalid = makeWorld({
      defaultBackend: { kind: "s3", config: { endpoint: "nope" }, secretKey: null },
    });
    valueOf(
      await invalid.run(
        completeSetup({
          name: "A",
          email: "a@example.com",
          password: "long enough pass",
          token: TOKEN,
        }),
      ),
    );
    expect(invalid.calls.backendCreates[0]?.config).toEqual({ endpoint: "nope" });
  });

  it("setup creates the deployment's default backend with its secret sealed", async () => {
    const { run, calls } = makeWorld({
      defaultBackend: { kind: "s3", config: s3, secretKey: Redacted.make("env-secret") },
    });
    valueOf(
      await run(
        completeSetup({
          name: "A",
          email: "a@example.com",
          password: "long enough pass",
          token: TOKEN,
        }),
      ),
    );
    const record = calls.backendCreates[0];
    expect(record?.kind).toBe("s3");
    expect(record?.secretKey).toBe(`sealed:${record?.id}:env-secret`);
    expect(calls.mountCreates[0]?.backendId).toBe(record?.id);
  });
});

describe("openNamespace with stored backends", () => {
  it("opens each Mount's backend from its stored record, configuration included", async () => {
    const opened: BackendRecord[] = [];
    const stored = { ...backend("b-1", "s3"), config: { bucket: "x" }, secretKey: "sealed" };
    const world = makeWorld({ backends: [stored], mounts: [mount("m-1", "files", "b-1")] });
    const layer = Layer.succeed(StorageOpener, {
      open: (record: BackendRecord) => {
        opened.push(record);
        return createMemoryStorage();
      },
    });
    const namespace = valueOf(await world.run(Effect.provide(openNamespace, layer)));
    expect(opened).toEqual([stored]);
    expect((await namespace.stat(["files"])).ok).toBe(true);
  });
});

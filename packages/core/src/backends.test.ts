import { Cause, Effect, Exit, Layer, Option, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { checkBackends, removeBackend, updateBackend, verifyBackend } from "./backends";
import { CredentialCipher } from "./credentials";
import {
  listBackends,
  publicConfig,
  Records,
  StorageOpener,
  type BackendRecord,
  type MountRecord,
} from "./instance";
import { createMemoryStorage } from "./memory-storage";
import { InstanceSettings, saveStorageSettings, storageSettings } from "./settings";
import { fail, ok, type StorageBackend } from "./storage";

// Changing, checking and removing backends, and the storage settings, against fake Ports.

const CREATED = new Date("2026-01-02T03:04:05.000Z");

const S3_CONFIG = {
  endpoint: "https://s3.example.com",
  region: "eu-west-1",
  bucket: "photos",
  prefix: "davloom/",
  forcePathStyle: true,
  accessKeyId: "AKIA1",
};

const record = (id: string, kind = "durable-object", extra: Partial<BackendRecord> = {}) =>
  ({
    id,
    name: `Backend ${id}`,
    kind,
    config: kind === "s3" ? S3_CONFIG : {},
    secretKey: kind === "s3" ? "sealed:old" : null,
    createdAt: CREATED,
    ...extra,
  }) satisfies BackendRecord;

const mount = (backendId: string): MountRecord => ({
  id: `m-${backendId}`,
  name: "files",
  backendId,
  backendKind: "durable-object",
  root: "",
  createdAt: CREATED,
});

const world = (
  options: {
    backends?: BackendRecord[];
    mounts?: MountRecord[];
    storages?: Record<string, StorageBackend | null>;
    unique?: boolean;
    broken?: boolean;
    vanishing?: boolean;
    settings?: Record<string, unknown>;
  } = {},
) => {
  const backends = [...(options.backends ?? [])];
  const settings = new Map(Object.entries(options.settings ?? {}));
  const records = {
    users: { count: () => Promise.resolve(1) },
    backends: {
      list: () => Promise.resolve([...backends]),
      create: () => Promise.resolve(),
      update: (id: string, change: { name: string; config: unknown; secretKey: string | null }) => {
        if (options.unique)
          return Promise.reject(
            new Error("update failed", { cause: new Error("UNIQUE constraint failed: name") }),
          );
        if (options.broken) return Promise.reject(new Error("disk I/O error"));
        const index = backends.findIndex((b) => b.id === id);
        const current = backends[index];
        if (current === undefined) return Promise.resolve(false);
        backends[index] = { ...current, ...change };
        return Promise.resolve(true);
      },
      remove: (id: string) => {
        if (options.vanishing) return Promise.resolve(false);
        const index = backends.findIndex((b) => b.id === id);
        if (index === -1) return Promise.resolve(false);
        backends.splice(index, 1);
        return Promise.resolve(true);
      },
    },
    mounts: {
      list: () => Promise.resolve([...(options.mounts ?? [])]),
      create: () => Promise.resolve(),
      rename: () => Promise.resolve(false),
      retarget: () => Promise.resolve(false),
      remove: () => Promise.resolve(false),
    },
    apiKeys: {
      findByHash: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      remove: () => Promise.resolve(false),
      rename: () => Promise.resolve(false),
      recordUse: () => Promise.resolve(),
    },
  };
  const layer = Layer.mergeAll(
    Layer.succeed(Records, records),
    Layer.succeed(StorageOpener, {
      open: (backend: BackendRecord) =>
        options.storages && backend.id in options.storages
          ? (options.storages[backend.id] ?? null)
          : createMemoryStorage(),
    }),
    Layer.succeed(CredentialCipher, {
      seal: (id: string, secret: Redacted.Redacted) =>
        Effect.succeed(`sealed:${id}:${Redacted.value(secret)}`),
      open: (_id: string, sealed: string) => Effect.succeed(Redacted.make(sealed)),
    }),
    Layer.succeed(InstanceSettings, {
      get: (key: string) => Promise.resolve(settings.get(key)),
      set: (key: string, value: unknown) => {
        settings.set(key, value);
        return Promise.resolve();
      },
    }),
  );
  const run = <A, E>(
    program: Effect.Effect<A, E, Records | StorageOpener | CredentialCipher | InstanceSettings>,
  ) => Effect.runPromiseExit(Effect.provide(program, layer));
  return { run, backends, settings };
};

const valueOf = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (!Exit.isSuccess(exit)) throw new Error(`expected success, got ${Cause.pretty(exit.cause)}`);
  return exit.value;
};

const tagOf = <A, E extends { _tag: string }>(exit: Exit.Exit<A, E>): string | undefined => {
  if (Exit.isSuccess(exit)) return undefined;
  const failure = Cause.findErrorOption(exit.cause);
  return Option.isSome(failure) ? failure.value._tag : "defect";
};

describe("publicConfig", () => {
  it.each([
    ["s3", { ...S3_CONFIG, secretAccessKey: "x", secretKey: "y" }, S3_CONFIG],
    ["r2", { binding: "R2", prefix: "", token: "x" }, { binding: "R2", prefix: "" }],
    ["durable-object", { anything: "x" }, {}],
    ["s3", null, {}],
    ["s3", "text", {}],
    ["s3", { endpoint: 5, bucket: "b" }, { bucket: "b" }],
  ])("shows a %s backend's %j as %j", (kind, config, view) => {
    expect(publicConfig(kind, config)).toEqual(view);
  });
});

describe("listBackends", () => {
  it("shows the capacity a backend knows, its configuration, and never its secret", async () => {
    const { run } = world({
      backends: [record("do"), record("s3", "s3")],
      storages: { do: createMemoryStorage({ capacity: 1000 }), s3: createMemoryStorage() },
    });
    const [durable, s3] = valueOf(await run(listBackends));
    expect(durable).toMatchObject({ capacity: 1000, config: {}, hasSecretKey: false });
    expect(s3).toMatchObject({ capacity: null, config: S3_CONFIG, hasSecretKey: true });
    expect(JSON.stringify(s3)).not.toContain("sealed");
  });
});

describe("updateBackend", () => {
  it("renames a Durable Objects backend and keeps its configuration", async () => {
    const { run, backends } = world({ backends: [record("do")] });
    expect(valueOf(await run(updateBackend("do", { name: "  Main " })))).toEqual({ id: "do" });
    expect(backends[0]).toMatchObject({ name: "Main", config: {}, secretKey: null });
  });

  it("keeps an S3 backend's stored secret when none is given", async () => {
    const { run, backends } = world({ backends: [record("s3", "s3")] });
    const config = { ...S3_CONFIG, bucket: "other", prefix: "p" };
    valueOf(await run(updateBackend("s3", { name: "S3", config, secretKey: "" })));
    expect(backends[0]).toMatchObject({
      config: { ...config, prefix: "p/" },
      secretKey: "sealed:old",
    });
  });

  it("seals a new secret", async () => {
    const { run, backends } = world({ backends: [record("s3", "s3")] });
    valueOf(await run(updateBackend("s3", { name: "S3", config: S3_CONFIG, secretKey: "new" })));
    expect(backends[0]?.secretKey).toBe("sealed:s3:new");
  });

  it("checks an R2 backend's configuration", async () => {
    const { run, backends } = world({
      backends: [record("r2", "r2", { config: { binding: "R2", prefix: "" } })],
    });
    valueOf(await run(updateBackend("r2", { name: "R2", config: { binding: "B", prefix: "x" } })));
    expect(backends[0]?.config).toEqual({ binding: "B", prefix: "x/" });
    expect(tagOf(await run(updateBackend("r2", { name: "R2", config: { binding: "1" } })))).toBe(
      "InvalidInput",
    );
  });

  it.each([
    ["an unknown backend", "nope", { name: "x" }, "NotFound"],
    ["an empty name", "s3", { name: " " }, "InvalidInput"],
    ["a long name", "s3", { name: "n".repeat(65) }, "InvalidInput"],
    [
      "an invalid endpoint",
      "s3",
      { name: "S3", config: { ...S3_CONFIG, endpoint: "x" } },
      "InvalidInput",
    ],
    [
      "a long secret",
      "s3",
      { name: "S3", config: S3_CONFIG, secretKey: "s".repeat(257) },
      "InvalidInput",
    ],
    ["no secret at all", "bare", { name: "S3", config: S3_CONFIG }, "InvalidInput"],
  ])("refuses %s", async (_, id, input, tag) => {
    const { run } = world({
      backends: [record("s3", "s3"), record("bare", "s3", { secretKey: null })],
    });
    expect(tagOf(await run(updateBackend(id, input)))).toBe(tag);
  });

  it("names a name another backend has as taken", async () => {
    const { run } = world({ backends: [record("do")], unique: true });
    expect(tagOf(await run(updateBackend("do", { name: "Taken" })))).toBe("NameTaken");
  });
});

/** A clock that moves 25 ms each time it is read. */
const clock = () => {
  let time = 1_000;
  return () => (time += 25);
};

describe("listBackends, quota", () => {
  it("knows no capacity for a backend without a quota, or whose quota fails", async () => {
    const { run } = world({
      backends: [record("a"), record("b")],
      storages: {
        a: { ...createMemoryStorage({ capacity: 10 }), quota: undefined },
        b: {
          ...createMemoryStorage({ capacity: 10 }),
          quota: () => Promise.resolve(fail("unavailable")),
        },
      },
    });
    expect(valueOf(await run(listBackends)).map((backend) => backend.capacity)).toEqual([
      null,
      null,
    ]);
  });
});

describe("failures of the records", () => {
  it("dies on an update that fails for another reason", async () => {
    const { run } = world({ backends: [record("do")], broken: true });
    expect(tagOf(await run(updateBackend("do", { name: "x" })))).toBe("defect");
  });

  it("names a backend gone before its record could be removed as not found", async () => {
    const { run } = world({ backends: [record("do")], vanishing: true });
    expect(tagOf(await run(removeBackend("do")))).toBe("NotFound");
  });
});

describe("verifyBackend and checkBackends", () => {
  it("reports how long a backend took to answer", async () => {
    const { run } = world({ backends: [record("do")] });
    expect(valueOf(await run(verifyBackend("do", clock())))).toEqual({
      id: "do",
      name: "Backend do",
      available: true,
      latencyMs: 25,
      reason: null,
      checkedAt: new Date(1_050).toISOString(),
    });
  });

  it.each([
    [
      "the store's own reason",
      { ...createMemoryStorage(), check: () => Promise.resolve({ ok: false, reason: "Nope" }) },
      "Nope",
    ],
    [
      "a root that does not answer",
      { ...createMemoryStorage(), stat: () => Promise.resolve(fail("unavailable")) },
      "No answer from the backend",
    ],
    [
      "a failure without words",
      { ...createMemoryStorage(), stat: () => Promise.resolve(fail("too-many")) },
      "too-many",
    ],
    ["a kind this server cannot open", null, "This server cannot open durable-object backends"],
  ])("reports %s", async (_, storage, reason) => {
    const { run } = world({ backends: [record("do")], storages: { do: storage } });
    expect(valueOf(await run(verifyBackend("do", clock())))).toMatchObject({
      available: false,
      latencyMs: null,
      reason,
    });
  });

  it("refuses an unknown backend", async () => {
    const { run } = world();
    expect(tagOf(await run(verifyBackend("nope")))).toBe("NotFound");
  });

  it("checks every backend", async () => {
    const { run } = world({
      backends: [record("a"), record("b")],
      storages: { b: { ...createMemoryStorage(), check: () => Promise.resolve({ ok: true }) } },
    });
    const checked = valueOf(await run(checkBackends()));
    expect(checked.map((item) => [item.id, item.available])).toEqual([
      ["a", true],
      ["b", true],
    ]);
  });
});

describe("removeBackend", () => {
  it("removes a backend no Mount uses, and says whether its files stay", async () => {
    const { run, backends } = world({ backends: [record("do"), record("s3", "s3")] });
    expect(valueOf(await run(removeBackend("s3")))).toEqual({ id: "s3", filesKept: true });
    expect(valueOf(await run(removeBackend("do")))).toEqual({ id: "do", filesKept: false });
    expect(backends).toEqual([]);
  });

  it("releases what the backend holds outside the records", async () => {
    let released = 0;
    const storage: StorageBackend = {
      ...createMemoryStorage(),
      release: () => {
        released += 1;
        return Promise.resolve(ok(null));
      },
    };
    const { run } = world({ backends: [record("do")], storages: { do: storage } });
    valueOf(await run(removeBackend("do")));
    expect(released).toBe(1);
  });

  it.each([
    ["used by a Mount", { mounts: [mount("do")] }, "BackendInUse"],
    [
      "that still holds files",
      {
        storages: {
          do: { ...createMemoryStorage(), release: () => Promise.resolve(fail("exists")) },
        },
      },
      "BackendNotEmpty",
    ],
    [
      "that does not answer",
      {
        storages: {
          do: { ...createMemoryStorage(), release: () => Promise.resolve(fail("unavailable")) },
        },
      },
      "BackendUnavailable",
    ],
  ])("refuses a backend %s and keeps it", async (_, options, tag) => {
    const { run, backends } = world({ backends: [record("do")], ...options });
    expect(tagOf(await run(removeBackend("do")))).toBe(tag);
    expect(backends).toHaveLength(1);
  });

  it("refuses an unknown backend", async () => {
    const { run } = world();
    expect(tagOf(await run(removeBackend("nope")))).toBe("NotFound");
  });

  it("removes a backend whose kind this server cannot open", async () => {
    const { run } = world({ backends: [record("x", "r2")], storages: { x: null } });
    expect(valueOf(await run(removeBackend("x")))).toEqual({ id: "x", filesKept: true });
  });
});

describe("storage settings", () => {
  it.each([
    ["the first backend when none was chosen", undefined, "a"],
    ["the chosen backend", "b", "b"],
    ["the first backend when the chosen one is gone", "gone", "a"],
  ])("names %s", async (_, stored, expected) => {
    const { run } = world({
      backends: [record("a"), record("b")],
      settings: stored === undefined ? {} : { "storage.defaultBackendId": stored },
    });
    expect(valueOf(await run(storageSettings))).toEqual({ defaultBackendId: expected });
  });

  it("names no backend while there is none", async () => {
    const { run } = world();
    expect(valueOf(await run(storageSettings))).toEqual({ defaultBackendId: null });
  });

  it("saves a backend that exists and refuses any other value", async () => {
    const { run, settings } = world({ backends: [record("a"), record("b")] });
    expect(valueOf(await run(saveStorageSettings({ defaultBackendId: "b" })))).toEqual({
      defaultBackendId: "b",
    });
    expect(settings.get("storage.defaultBackendId")).toBe("b");
    for (const value of ["nope", 5, null, undefined]) {
      expect(tagOf(await run(saveStorageSettings({ defaultBackendId: value })))).toBe(
        "InvalidInput",
      );
    }
    expect(valueOf(await run(storageSettings))).toEqual({ defaultBackendId: "b" });
  });
});

import { Effect, Exit, Layer, Redacted, type Context } from "effect";
import { describe, expect, it } from "vitest";
import {
  Archive,
  ArchiveInvalid,
  describeRejection,
  exportInstance,
  importEntries,
  importInstance,
  mapArchiveTables,
  openArchive,
  sealArchive,
  type ArchiveRow,
  type ArchiveTables,
} from "./archive";
import { CredentialCipher, CredentialsError, makeCredentialCipher } from "./credentials";
import { InstanceConfig, Records, SetupClosed } from "./instance";

// The export and import services against a fake Archive that keeps its rows in memory. The
// database package runs the same services against Bun SQLite.

const TOKEN = "setup-token-0123456789";
const SECRET = "s".repeat(32);

const empty = (): ArchiveTables => mapArchiveTables(() => []);

interface World {
  readonly tables?: ArchiveTables;
  readonly config?: Partial<Context.Service.Shape<typeof InstanceConfig>>;
  readonly users?: number;
  readonly problem?: string | null;
  readonly refuseWrite?: boolean;
}

const world = (options: World = {}) => {
  let stored = options.tables ?? empty();
  const writes: ArchiveTables[] = [];
  const layer = Layer.mergeAll(
    Layer.succeed(Archive, {
      read: () => Promise.resolve(stored),
      check: () => options.problem ?? null,
      write: (tables) => {
        if (options.refuseWrite) return Promise.reject(new Error("UNIQUE constraint failed"));
        writes.push(tables);
        stored = mapArchiveTables((table) => [...stored[table], ...tables[table]]);
        return Promise.resolve();
      },
    }),
    Layer.succeed(InstanceConfig, { setupToken: TOKEN, storageKinds: ["s3"], ...options.config }),
    Layer.succeed(Records, {
      users: { count: () => Promise.resolve(options.users ?? 0) },
      backends: {
        list: () => Promise.resolve([]),
        create: () => Promise.resolve(),
        update: () => Promise.resolve(false),
        remove: () => Promise.resolve(false),
      },
      mounts: {
        list: () => Promise.resolve([]),
        create: () => Promise.resolve(),
        rename: () => Promise.resolve(false),
        retarget: () => Promise.resolve(false),
        remove: () => Promise.resolve(false),
      },
      apiKeys: {
        findByHash: () => Promise.resolve(null),
        list: () => Promise.resolve([]),
        remove: () => Promise.resolve(false),
        recordUse: () => Promise.resolve(),
        rename: () => Promise.resolve(false),
      },
    }),
    Layer.effect(CredentialCipher, makeCredentialCipher(Redacted.make(SECRET))),
  );
  const run = <A, E>(
    effect: Effect.Effect<A, E, Archive | InstanceConfig | Records | CredentialCipher>,
  ) => Effect.runPromiseExit(Effect.provide(effect, layer));
  return { run, writes, read: () => stored };
};

const errorOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail"
    ? exit.cause.reasons[0].error
    : null;

const reasonOf = (exit: Exit.Exit<unknown, unknown>) => {
  const error = errorOf(exit);
  return error instanceof ArchiveInvalid ? error.reason : null;
};

/** Seals any value as an export's tables, as a damaged or foreign export would hold them. */
const sealed = async (tables: unknown) => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the point is to seal what an export should not hold
  const exit = await Effect.runPromiseExit(sealArchive(tables as ArchiveTables));
  if (!Exit.isSuccess(exit)) throw new Error("sealing failed");
  return { key: Redacted.value(exit.value.key), file: exit.value.file };
};

const row = (values: Record<string, unknown>): ArchiveRow => values;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** A file encrypted with a key, holding any bytes, as a damaged or foreign export would. */
const fileOf = async (plain: Uint8Array<ArrayBuffer>) => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const data = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("davloom-export v1") },
      key,
      plain,
    ),
  );
  return {
    key: `dvx_${b64(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`,
    file: { format: "davloom-export", version: 1, createdAt: "", iv: b64(iv), data: b64(data) },
  };
};

describe("openArchive", () => {
  const OPEN_CASES: readonly (readonly [
    string,
    () => Promise<{ key: string; file: unknown }>,
    RegExp,
  ])[] = [
    ["a payload that is not JSON", () => fileOf(new TextEncoder().encode("{")), /damaged/],
    ["a payload that is not UTF-8", () => fileOf(new Uint8Array([0xff, 0xfe])), /does not open/],
    ["a payload without tables", () => fileOf(new TextEncoder().encode("{}")), /no records/],
    ["a payload that is a list", () => fileOf(new TextEncoder().encode("[]")), /no records/],
    ["tables that are a list", () => sealed([]), /no records/],
    ["a table that is not a list", () => sealed({ user: {} }), /rows of user are not a list/],
    ["a row that is not a record", () => sealed({ mounts: [1] }), /rows of mounts are not a list/],
    ["a row that is a list", () => sealed({ apikey: [[]] }), /rows of apikey are not a list/],
    [
      "iv that is not text",
      async () => ({
        ...(await sealed({})),
        file: { format: "davloom-export", version: 1, iv: 1, data: "" },
      }),
      /not a Davloom export/,
    ],
    [
      "data that is not text",
      async () => ({
        ...(await sealed({})),
        file: { format: "davloom-export", version: 1, iv: "", data: null },
      }),
      /not a Davloom export/,
    ],
    [
      "a file that is null",
      async () => ({ ...(await sealed({})), file: null }),
      /not a Davloom export/,
    ],
    [
      "a file that is a list",
      async () => ({ ...(await sealed({})), file: [] }),
      /not a Davloom export/,
    ],
  ];

  it.each(OPEN_CASES)("refuses %s", async (_, make, reason) => {
    const { key, file } = await make();
    expect(reasonOf(await Effect.runPromiseExit(openArchive(file, key)))).toMatch(reason);
  });

  it("reads a missing table as empty", async () => {
    const { key, file } = await sealed({ user: [{ id: "u" }] });
    const exit = await Effect.runPromiseExit(openArchive(file, key));
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ ...empty(), user: [{ id: "u" }] });
  });
});

const needsOf = (metadata: unknown) =>
  importEntries({
    ...empty(),
    apikey: [row({ id: "k", key: "h", reference_id: "u", metadata })],
  })[0]?.entry.needs;

describe("importEntries", () => {
  it.each([
    ["no metadata", null, ["user:u"]],
    ["metadata without paths", { access: "read-only" }, ["user:u"]],
    [
      "metadata as JSON text",
      JSON.stringify({ paths: ["/a/x", "/b", "/a/y"] }),
      ["user:u", "mount-name:a", "mount-name:b"],
    ],
    ["metadata as an object", { paths: ["/c"] }, ["user:u", "mount-name:c"]],
    ["metadata that is not JSON", "{", ["user:u"]],
    ["paths that are not roots", { paths: "everything" }, ["user:u"]],
    ["metadata that is a list", [1], ["user:u"]],
  ])("a key with %s needs its user and its Mounts", (_, metadata, needs) => {
    expect(needsOf(metadata)).toEqual(needs);
  });

  it("reads a value that is not text as empty", () => {
    expect(importEntries({ ...empty(), user: [row({ id: 7, email: null })] })).toEqual([
      { label: "user ", entry: { defines: ["user:", "email:"], needs: [] } },
    ]);
  });

  it("names a key without a name by its id, and the root's properties by /", () => {
    const entries = importEntries({
      ...empty(),
      apikey: [row({ id: "k9", key: "h", reference_id: "u" })],
      dav_properties: [row({ backend_id: "b", path: "", name: "{x}y" })],
    });
    expect(entries.map((entry) => entry.label)).toEqual(["API Key k9", "property {x}y of /"]);
  });
});

describe("describeRejection", () => {
  it.each([
    [
      [{ label: "Mount m", entry: { defines: ["m"], needs: ["b"] } }],
      [],
      "The Mount m needs b, which nothing defines.",
    ],
    [
      [{ label: "user u", entry: { defines: ["u", "u"], needs: [] } }],
      [],
      "The user u repeats u, which is defined already.",
    ],
    [
      [{ label: "x", entry: { defines: ["k"], needs: [] } }],
      ["k"],
      "The x repeats k, which is defined already.",
    ],
    [
      [{ label: "x", entry: { defines: ["k"], needs: [] } }],
      [],
      "The records do not fit together.",
    ],
  ] as const)("names the first entry that cannot be applied", (planned, known, message) => {
    expect(describeRejection(planned, known)).toBe(message);
  });
});

describe("exportInstance", () => {
  it("decrypts each sealed secret key into the encrypted file", async () => {
    const cipher = await Effect.runPromise(makeCredentialCipher(Redacted.make(SECRET)));
    const secret = await Effect.runPromise(cipher.seal("b1", Redacted.make("hidden")));
    const tables = {
      ...empty(),
      storage_backends: [
        row({ id: "b1", secret_key: secret }),
        row({ id: "b2", secret_key: null }),
      ],
    };
    const exit = await world({ tables }).run(exportInstance);
    if (!Exit.isSuccess(exit)) throw new Error("the export failed");
    const opened = await Effect.runPromiseExit(
      openArchive(exit.value.file, Redacted.value(exit.value.key)),
    );
    expect(Exit.isSuccess(opened) && opened.value.storage_backends).toEqual([
      { id: "b1", secret_key: "hidden" },
      { id: "b2", secret_key: null },
    ]);
  });

  it("fails when a secret key does not decrypt", async () => {
    const tables = { ...empty(), storage_backends: [row({ id: "b1", secret_key: "v1.x.y" })] };
    expect(errorOf(await world({ tables }).run(exportInstance))).toBeInstanceOf(CredentialsError);
  });
});

const backend = (id: string, name: string, kind = "durable-object") =>
  row({ id, name, kind, config: {}, secret_key: null });

describe("importInstance", () => {
  const S3 = {
    kind: "s3",
    config: {
      endpoint: "http://rustfs:9000",
      region: "us-east-1",
      bucket: "davloom",
      forcePathStyle: true,
      accessKeyId: "id",
    },
    secretKey: Redacted.make("secret"),
  };
  it("refuses rows the database does not accept, and writes nothing", async () => {
    const w = world({ problem: "The name of row 1 of mounts is not text." });
    const { key, file } = await sealed(empty());
    expect(reasonOf(await w.run(importInstance({ token: TOKEN, key, file })))).toBe(
      "The name of row 1 of mounts is not text.",
    );
    expect(w.writes).toEqual([]);
  });

  it("reports a write the database refused", async () => {
    const w = world({ refuseWrite: true });
    const { key, file } = await sealed(empty());
    expect(reasonOf(await w.run(importInstance({ token: TOKEN, key, file })))).toMatch(
      /database refused/,
    );
  });

  it("refuses an instance with a user", async () => {
    const { key, file } = await sealed(empty());
    expect(
      errorOf(await world({ users: 1 }).run(importInstance({ token: TOKEN, key, file }))),
    ).toBeInstanceOf(SetupClosed);
  });

  it.each([
    ["no default backend", {}, [["A", "durable-object"]]],
    [
      "a backend that runs here",
      { storageKinds: ["durable-object"], defaultBackend: S3 },
      [["A", "durable-object"]],
    ],
    [
      "only backends that do not run here",
      { defaultBackend: S3 },
      [
        ["A", "durable-object"],
        ["Default", "s3"],
      ],
    ],
    [
      "a default of another kind",
      { defaultBackend: { kind: "memory", config: { x: 1 }, secretKey: null } },
      [
        ["A", "durable-object"],
        ["Default", "memory"],
      ],
    ],
  ] as const)("with %s, imports the backends it should", async (_, config, expected) => {
    const w = world({ config });
    const { key, file } = await sealed({ ...empty(), storage_backends: [backend("b1", "A")] });
    expect(Exit.isSuccess(await w.run(importInstance({ token: TOKEN, key, file })))).toBe(true);
    expect(w.read().storage_backends.map((r) => [r["name"], r["kind"]])).toEqual(expected);
  });

  it("names the added backend after the names the export uses", async () => {
    const w = world({ config: { defaultBackend: S3 } });
    const { key, file } = await sealed({
      ...empty(),
      storage_backends: [backend("b1", "Default"), backend("b2", "Default 2")],
    });
    expect(Exit.isSuccess(await w.run(importInstance({ token: TOKEN, key, file })))).toBe(true);
    const added = w.read().storage_backends[2];
    expect(added?.["name"]).toBe("Default 3");
    expect(added?.["config"]).toMatchObject(S3.config);
    expect(String(added?.["secret_key"])).toMatch(/^v1\./);
  });

  it("keeps a default S3 configuration that does not check as it is", async () => {
    const w = world({
      config: { defaultBackend: { ...S3, config: { bucket: 1 }, secretKey: null } },
    });
    const { key, file } = await sealed(empty());
    expect(Exit.isSuccess(await w.run(importInstance({ token: TOKEN, key, file })))).toBe(true);
    expect(w.read().storage_backends[0]).toMatchObject({ config: { bucket: 1 }, secret_key: null });
  });
});

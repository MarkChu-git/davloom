import { Database } from "bun:sqlite";
import {
  Archive,
  ArchiveInvalid,
  CredentialCipher,
  exportInstance,
  importInstance,
  InstanceConfig,
  makeCredentialCipher,
  Records,
  sealArchive,
  SetupClosed,
  SetupTokenInvalid,
  type ArchiveRow,
  type ArchiveTables,
} from "@davloom/core";
import { Effect, Exit, Layer, Redacted, type Context } from "effect";
import { describe, expect, it } from "vitest";
import { createArchive } from "./archive";
import { bunSqliteAtomic, createBunSqliteDatabase, migrateBunSqliteDatabase } from "./bun-sqlite";
import { createRepositories } from "./repositories";
import * as schema from "./schema";

// Export and import through the real services, between two migrated in-memory Bun SQLite
// databases with different instance secrets, as a move from one instance to another does.

const TOKEN = "setup-token-0123456789";
const T0 = new Date("2026-03-04T05:06:07.000Z");

const instance = (
  secret: string,
  setupToken: string | null = TOKEN,
  config: Partial<Context.Service.Shape<typeof InstanceConfig>> = {},
) => {
  const db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  const archive = createArchive(db, bunSqliteAtomic(db));
  const layer = Layer.mergeAll(
    Layer.succeed(Records, createRepositories(db)),
    Layer.succeed(Archive, archive),
    Layer.succeed(InstanceConfig, { setupToken, storageKinds: ["s3"], ...config }),
    Layer.effect(CredentialCipher, makeCredentialCipher(Redacted.make(secret))),
  );
  const run = <A, E>(
    effect: Effect.Effect<A, E, Records | Archive | InstanceConfig | CredentialCipher>,
  ) => Effect.runPromiseExit(Effect.provide(effect, layer));
  return { db, archive, run };
};

type Instance = ReturnType<typeof instance>;

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);

/** Fills an instance with one of every record, a scoped key and a sealed secret key among them. */
const seed = async (source: Instance) => {
  const { db } = source;
  await db.insert(schema.user).values({
    id: "u1",
    name: "Admin",
    email: "admin@davloom.test",
    emailVerified: true,
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(schema.account).values({
    id: "a1",
    accountId: "u1",
    providerId: "credential",
    userId: "u1",
    password: "salt:hash", // gitleaks:allow
    createdAt: T0,
    updatedAt: T0,
  });
  const sealed = await Effect.runPromise(
    Effect.flatMap(makeCredentialCipher(Redacted.make(SECRET_A)), (cipher) =>
      cipher.seal("b2", Redacted.make("s3-secret-value")),
    ),
  );
  await db.insert(schema.storageBackends).values([
    { id: "b1", name: "Default", kind: "durable-object", config: {}, createdAt: T0, updatedAt: T0 },
    {
      id: "b2",
      name: "Archive",
      kind: "s3",
      config: { endpoint: "http://localhost:9000", bucket: "x" },
      secretKey: sealed,
      createdAt: T0,
      updatedAt: T0,
    },
  ]);
  await db.insert(schema.mounts).values([
    { id: "m1", name: "files", backendId: "b1", root: "", createdAt: T0, updatedAt: T0 },
    { id: "m2", name: "photos", backendId: "b2", root: "2026", createdAt: T0, updatedAt: T0 },
  ]);
  await db.insert(schema.apikey).values([
    {
      id: "k1",
      name: "laptop",
      start: "dav_ab",
      prefix: "dav_",
      key: "hash-1",
      referenceId: "u1",
      metadata: JSON.stringify({ access: "read-write" }),
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: "k2",
      name: "camera",
      key: "hash-2",
      referenceId: "u1",
      metadata: JSON.stringify({ access: "read-write", paths: ["/photos/upload"] }),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: T0,
      updatedAt: T0,
    },
  ]);
  await db.insert(schema.davProperties).values([
    {
      backendId: "b2",
      path: "2026/a.jpg",
      name: "{urn:x}tag",
      xml: '<x:tag xmlns:x="urn:x">1</x:tag>',
    },
  ]);
};

const exported = async (source: Instance) => {
  const exit = await source.run(exportInstance);
  if (!Exit.isSuccess(exit)) throw new Error("the export failed");
  return { key: Redacted.value(exit.value.key), file: exit.value.file };
};

/** The rows of a table without the secret key, which each instance seals with its own secret. */
const withoutSecrets = (tables: ArchiveTables): ArchiveTables => ({
  ...tables,
  storage_backends: tables.storage_backends.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([column]) => column !== "secret_key")),
  ),
});

const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail"
    ? exit.cause.reasons[0].error
    : null;

describe("export and import", () => {
  it("moves every record to an instance with another secret", async () => {
    const source = instance(SECRET_A);
    await seed(source);
    const { key, file } = await exported(source);
    expect(key).toMatch(/^dvx_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(file)).not.toContain("s3-secret-value");
    expect(JSON.stringify(file)).not.toContain("admin@davloom.test");

    const target = instance(SECRET_B);
    const exit = await target.run(importInstance({ token: TOKEN, key, file }));
    expect(Exit.isSuccess(exit) && exit.value).toEqual({
      user: 1,
      account: 1,
      storage_backends: 2,
      mounts: 2,
      apikey: 2,
      dav_properties: 1,
    });
    const before = await source.archive.read();
    const after = await target.archive.read();
    expect(withoutSecrets(after)).toEqual(withoutSecrets(before));
    // The secret key is sealed again with the target's secret, and opens there to the same value.
    const resealed = after.storage_backends.find((row) => row["id"] === "b2")?.["secret_key"];
    expect(resealed).not.toEqual(before.storage_backends[1]?.["secret_key"]);
    const opened = await Effect.runPromise(
      Effect.flatMap(makeCredentialCipher(Redacted.make(SECRET_B)), (cipher) =>
        cipher.open("b2", String(resealed)),
      ),
    );
    expect(Redacted.value(opened)).toBe("s3-secret-value");
  });

  const S3 = {
    kind: "s3",
    config: {
      endpoint: "http://rustfs:9000",
      region: "us-east-1",
      bucket: "davloom",
      forcePathStyle: true,
      accessKeyId: "rustfsadmin",
    },
    secretKey: Redacted.make("rustfs-secret"),
  };

  it("adds the deployment's backend when no imported backend runs here", async () => {
    const source = instance(SECRET_A);
    await seed(source);
    const { key, file } = await crafted((t) => ({
      ...t,
      storage_backends: t.storage_backends.map((row) => ({
        ...row,
        kind: "durable-object",
        secret_key: null,
      })),
    }));
    const target = instance(SECRET_B, TOKEN, { storageKinds: ["s3"], defaultBackend: S3 });
    expect(Exit.isSuccess(await target.run(importInstance({ token: TOKEN, key, file })))).toBe(
      true,
    );
    const backends = (await target.archive.read()).storage_backends;
    expect(backends.map((row) => [row["name"], row["kind"]])).toEqual([
      ["Default", "durable-object"],
      ["Archive", "durable-object"],
      ["Default 2", "s3"],
    ]);
    const added = backends[2];
    const opened = await Effect.runPromise(
      Effect.flatMap(makeCredentialCipher(Redacted.make(SECRET_B)), (cipher) =>
        cipher.open(String(added?.["id"]), String(added?.["secret_key"])),
      ),
    );
    expect(Redacted.value(opened)).toBe("rustfs-secret");
  });

  it("adds no backend when an imported one runs here", async () => {
    const source = instance(SECRET_A);
    await seed(source);
    const { key, file } = await exported(source);
    const target = instance(SECRET_B, TOKEN, { storageKinds: ["s3"], defaultBackend: S3 });
    expect(Exit.isSuccess(await target.run(importInstance({ token: TOKEN, key, file })))).toBe(
      true,
    );
    expect((await target.archive.read()).storage_backends).toHaveLength(2);
  });

  it("exports an empty instance, and imports it", async () => {
    const { key, file } = await exported(instance(SECRET_A));
    const target = instance(SECRET_B);
    const exit = await target.run(importInstance({ token: TOKEN, key, file }));
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("imports many rows, more than one statement holds", async () => {
    const source = instance(SECRET_A);
    await seed(source);
    await source.db.insert(schema.davProperties).values(
      Array.from({ length: 450 }, (_, i) => ({
        backendId: "b1",
        path: `f${i}`,
        name: "{urn:x}n",
        xml: '<x:n xmlns:x="urn:x"/>',
      })),
    );
    const { key, file } = await exported(source);
    const target = instance(SECRET_B);
    expect(Exit.isSuccess(await target.run(importInstance({ token: TOKEN, key, file })))).toBe(
      true,
    );
    expect((await target.archive.read()).dav_properties).toHaveLength(451);
  });
});

// --- Imports that must change nothing -----------------------------------------------------

const crafted = async (change: (tables: ArchiveTables) => ArchiveTables) => {
  const source = instance(SECRET_A);
  await seed(source);
  const tables = await source.archive.read();
  const exit = await Effect.runPromiseExit(sealArchive(change(tables)));
  if (!Exit.isSuccess(exit)) throw new Error("sealing failed");
  return { key: Redacted.value(exit.value.key), file: exit.value.file };
};

const editRow =
  (table: keyof ArchiveTables, index: number, edit: (row: ArchiveRow) => ArchiveRow) =>
  (tables: ArchiveTables): ArchiveTables => ({
    ...tables,
    [table]: tables[table].map((row, i) => (i === index ? edit(row) : row)),
  });

const addRow =
  (table: keyof ArchiveTables, row: (tables: ArchiveTables) => ArchiveRow) =>
  (tables: ArchiveTables): ArchiveTables => ({
    ...tables,
    [table]: [...tables[table], row(tables)],
  });

const REJECTED: readonly (readonly [string, (tables: ArchiveTables) => ArchiveTables, RegExp])[] = [
  [
    "a Mount whose backend is not in the export",
    editRow("mounts", 1, (row) => ({ ...row, backend_id: "nowhere" })),
    /Mount photos needs backend:nowhere/,
  ],
  [
    "two backends with one name",
    editRow("storage_backends", 1, (row) => ({ ...row, name: "Default" })),
    /backend Default repeats backend-name:Default/,
  ],
  [
    "two backends with one id",
    editRow("storage_backends", 1, (row) => ({ ...row, id: "b1" })),
    /repeats backend:b1/,
  ],
  [
    "two users with one email",
    addRow("user", (t) => ({ ...t.user[0], id: "u2" })),
    /repeats email:admin@davloom.test/,
  ],
  [
    "a login of a user not in the export",
    editRow("account", 0, (row) => ({ ...row, user_id: "u9" })),
    /needs user:u9/,
  ],
  [
    "an API Key of a user not in the export",
    editRow("apikey", 0, (row) => ({ ...row, reference_id: "u9" })),
    /API Key laptop needs user:u9/,
  ],
  [
    "an API Key limited to a Mount not in the export",
    editRow("apikey", 1, (row) => ({
      ...row,
      metadata: JSON.stringify({ access: "read-only", paths: ["/gone"] }),
    })),
    /API Key camera needs mount-name:gone/,
  ],
  [
    "two API Keys with one hash",
    editRow("apikey", 1, (row) => ({ ...row, key: "hash-1" })),
    /repeats apikey-hash:hash-1/,
  ],
  [
    "a dead property of a backend not in the export",
    editRow("dav_properties", 0, (row) => ({ ...row, backend_id: "b9" })),
    /needs backend:b9/,
  ],
  [
    "two Mounts with one name",
    editRow("mounts", 1, (row) => ({ ...row, name: "files" })),
    /repeats mount-name:files/,
  ],
  [
    "an unknown column",
    editRow("mounts", 0, (row) => ({ ...row, color: "red" })),
    /unknown column color/,
  ],
  [
    "a missing column",
    editRow("mounts", 0, (row) =>
      Object.fromEntries(Object.entries(row).filter(([column]) => column !== "root")),
    ),
    /root of row 1 of mounts is missing/,
  ],
  [
    "a null in a required column",
    editRow("user", 0, (row) => ({ ...row, email: null })),
    /email of row 1 of user is missing/,
  ],
  [
    "text where a time belongs",
    editRow("user", 0, (row) => ({ ...row, created_at: "yesterday" })),
    /created_at of row 1 of user is not a whole number/,
  ],
  [
    "a number where text belongs",
    editRow("mounts", 0, (row) => ({ ...row, name: 7 })),
    /name of row 1 of mounts is not text/,
  ],
  [
    "a string where a flag belongs",
    editRow("user", 0, (row) => ({ ...row, email_verified: "yes" })),
    /not true or false/,
  ],
  [
    "two dead properties with one name, which the database refuses",
    addRow("dav_properties", (t) => ({ ...t.dav_properties[0] })),
    /database refused/,
  ],
];

describe("an import that fails changes nothing", () => {
  it.each(REJECTED)("%s", async (_, change, reason) => {
    const { key, file } = await crafted(change);
    const target = instance(SECRET_B);
    const before = await target.archive.read();
    const error = failure(await target.run(importInstance({ token: TOKEN, key, file })));
    expect(error).toBeInstanceOf(ArchiveInvalid);
    expect(error instanceof ArchiveInvalid && error.reason).toMatch(reason);
    expect(await target.archive.read()).toEqual(before);
  });

  const FILES: readonly (readonly [string, (file: Record<string, unknown>) => unknown, RegExp])[] =
    [
      ["not an object", () => "text", /not a Davloom export/],
      ["another format", (f) => ({ ...f, format: "other" }), /not a Davloom export/],
      ["another version", (f) => ({ ...f, version: 2 }), /version 1 only/],
      ["damaged data", (f) => ({ ...f, data: `A${String(f["data"]).slice(1)}` }), /does not open/],
      ["data that is not base64", (f) => ({ ...f, data: "%%%" }), /damaged/],
      ["a short IV", (f) => ({ ...f, iv: "AAAA" }), /damaged/],
    ];

  it.each(FILES)("a file that is %s", async (_, change, reason) => {
    const { key, file } = await crafted((t) => t);
    const target = instance(SECRET_B);
    const error = failure(
      await target.run(importInstance({ token: TOKEN, key, file: change({ ...file }) })),
    );
    expect(error instanceof ArchiveInvalid && error.reason).toMatch(reason);
    expect((await target.archive.read()).user).toEqual([]);
  });

  const KEYS: readonly (readonly [string, (key: string) => string, RegExp])[] = [
    ["another export's key", () => `dvx_${"A".repeat(43)}`, /does not open/],
    ["a key without its prefix", (k) => k.slice(4), /not a Davloom key/],
    ["a short key", (k) => k.slice(0, 20), /not a Davloom key/],
    ["a key with other characters", (k) => `${k.slice(0, -1)}!`, /not a Davloom key/],
    ["an empty key", () => "", /not a Davloom key/],
  ];

  it.each(KEYS)("%s", async (_, change, reason) => {
    const { key, file } = await crafted((t) => t);
    const target = instance(SECRET_B);
    const error = failure(
      await target.run(importInstance({ token: TOKEN, key: change(key), file })),
    );
    expect(error instanceof ArchiveInvalid && error.reason).toMatch(reason);
    expect((await target.archive.read()).user).toEqual([]);
  });

  it("refuses an instance that has a user", async () => {
    const { key, file } = await crafted((t) => t);
    const target = instance(SECRET_B);
    await seed(target);
    const before = await target.archive.read();
    expect(failure(await target.run(importInstance({ token: TOKEN, key, file })))).toBeInstanceOf(
      SetupClosed,
    );
    expect(await target.archive.read()).toEqual(before);
  });

  it("refuses a wrong setup token, and an instance without one", async () => {
    const { key, file } = await crafted((t) => t);
    expect(
      failure(await instance(SECRET_B).run(importInstance({ token: "wrong", key, file }))),
    ).toBeInstanceOf(SetupTokenInvalid);
    expect(
      failure(await instance(SECRET_B, null).run(importInstance({ token: TOKEN, key, file }))),
    ).toBeInstanceOf(SetupClosed);
  });

  it("refuses a backend id that the target holds already", async () => {
    const { key, file } = await crafted((t) => ({ ...t, user: [], account: [], apikey: [] }));
    const target = instance(SECRET_B);
    await target.db.insert(schema.storageBackends).values({
      id: "b1",
      name: "Here",
      kind: "s3",
      config: {},
      createdAt: T0,
      updatedAt: T0,
    });
    const before = await target.archive.read();
    const error = failure(await target.run(importInstance({ token: TOKEN, key, file })));
    expect(error instanceof ArchiveInvalid && error.reason).toMatch(/repeats backend:b1/);
    expect(await target.archive.read()).toEqual(before);
  });
});

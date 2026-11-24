import { exportHasOwner, planImport, type ImportEntry } from "@davloom/laws";
import { Context, Data, Effect, Redacted } from "effect";
import { checkS3Config } from "./backend-config";
import { CredentialCipher } from "./credentials";
import { InstanceConfig, Records, RegistrationClosed, requireSetupToken } from "./instance";
import { redactedError } from "./redact";
import { parseScope } from "./scope";

// Data export and import (PRD §8.5 Data Export, Data Migration). An export holds the records of an
// instance: its users and their password logins, its storage backends, Mounts, API Keys and dead
// properties and the instance's settings, as the rows of their tables. Sessions, verifications and locks are left out: they
// expire. The whole export is encrypted with AES-256-GCM under a random key that the admin gets
// once, beside the file, so no credential is ever exported in plaintext: not a backend's secret
// key, which the export carries decrypted inside the ciphertext, and not the hashes of passwords
// and API Keys. Only an instance without users imports, in place of registering its owner, and an import
// writes every row or none (the law import_all_or_nothing).

export const ARCHIVE_TABLES = [
  "user",
  "account",
  "storage_backends",
  "mounts",
  "apikey",
  "dav_properties",
  "settings",
] as const;
export type ArchiveTable = (typeof ARCHIVE_TABLES)[number];
export type ArchiveRow = Readonly<Record<string, unknown>>;
export type ArchiveTables = Readonly<Record<ArchiveTable, readonly ArchiveRow[]>>;

/** A value for each table, in the order rows are written. */
export const mapArchiveTables = <T>(f: (table: ArchiveTable) => T): Record<ArchiveTable, T> => ({
  user: f("user"),
  account: f("account"),
  storage_backends: f("storage_backends"),
  mounts: f("mounts"),
  apikey: f("apikey"),
  dav_properties: f("dav_properties"),
  settings: f("settings"),
});

/** The Port to the rows of the tables an export holds. Column names are those of the database. */
export class Archive extends Context.Service<
  Archive,
  {
    /** Every row of every table, with times in milliseconds since the epoch. */
    readonly read: () => Promise<ArchiveTables>;
    /** Why the rows do not fit the tables, such as a missing column or a value of the wrong type. */
    readonly check: (tables: ArchiveTables) => string | null;
    /** Inserts every row, or, when any insert fails, none. */
    readonly write: (tables: ArchiveTables) => Promise<void>;
  }
>()("@davloom/core/Archive") {}

/** An export that cannot be imported. `reason` names what is wrong and holds no secret. */
export class ArchiveInvalid extends Data.TaggedError("ArchiveInvalid")<{
  readonly reason: string;
}> {}

export const ARCHIVE_FORMAT = "davloom-export";
export const ARCHIVE_VERSION = 1;
const KEY_PREFIX = "dvx_";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AAD = new TextEncoder().encode("davloom-export v1");

/** The file an export writes: its format, when it was made, and the encrypted records. */
export interface ArchiveFile {
  readonly format: typeof ARCHIVE_FORMAT;
  readonly version: typeof ARCHIVE_VERSION;
  readonly createdAt: string;
  readonly iv: string;
  readonly data: string;
}

const SLICE = 0x8000;
const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let start = 0; start < bytes.length; start += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(start, start + SLICE));
  }
  return btoa(binary);
};
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> | null => {
  try {
    return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};
const toBase64Url = (bytes: Uint8Array) =>
  toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const fromBase64Url = (text: string) =>
  /^[A-Za-z0-9_-]*$/.test(text) ? fromBase64(text.replaceAll("-", "+").replaceAll("_", "/")) : null;

const importKey = (raw: Uint8Array<ArrayBuffer>, usage: "encrypt" | "decrypt") =>
  crypto.subtle.importKey("raw", raw, "AES-GCM", false, [usage]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (row: ArchiveRow, column: string): string =>
  typeof row[column] === "string" ? row[column] : "";

// --- Export ---------------------------------------------------------------------------------

/** Encrypts every record of the instance under a new key, and returns the file and the key. */
export const exportInstance = Effect.gen(function* () {
  const archive = yield* Archive;
  const cipher = yield* CredentialCipher;
  const tables = yield* Effect.promise(() => archive.read());
  const backends: ArchiveRow[] = [];
  for (const row of tables.storage_backends) {
    const sealed = row["secret_key"];
    if (typeof sealed !== "string") {
      backends.push(row);
      continue;
    }
    const secret = yield* cipher.open(text(row, "id"), sealed);
    backends.push({ ...row, secret_key: Redacted.value(secret) });
  }
  return yield* sealArchive({ ...tables, storage_backends: backends });
});

/** Encrypts records under a new key, as an export does. */
export const sealArchive = (tables: ArchiveTables) =>
  Effect.promise(async () => {
    const payload = JSON.stringify({ format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, tables });
    const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: AAD },
      await importKey(raw, "encrypt"),
      new TextEncoder().encode(payload),
    );
    const file: ArchiveFile = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      createdAt: new Date().toISOString(),
      iv: toBase64(iv),
      data: toBase64(new Uint8Array(data)),
    };
    return { key: Redacted.make(`${KEY_PREFIX}${toBase64Url(raw)}`), file };
  });

// --- Import ---------------------------------------------------------------------------------

const invalid = (reason: string) => Effect.fail(new ArchiveInvalid({ reason }));

/** The records an export file holds, decrypted with its key. */
export const openArchive = (file: unknown, key: string) =>
  Effect.gen(function* () {
    if (
      !isRecord(file) ||
      file["format"] !== ARCHIVE_FORMAT ||
      typeof file["iv"] !== "string" ||
      typeof file["data"] !== "string"
    ) {
      return yield* invalid("The file is not a Davloom export.");
    }
    if (file["version"] !== ARCHIVE_VERSION) {
      return yield* invalid(`This Davloom imports exports of version ${ARCHIVE_VERSION} only.`);
    }
    const raw = key.startsWith(KEY_PREFIX) ? fromBase64Url(key.slice(KEY_PREFIX.length)) : null;
    const iv = fromBase64(file["iv"]);
    const data = fromBase64(file["data"]);
    if (raw?.length !== KEY_BYTES) return yield* invalid("The export key is not a Davloom key.");
    if (iv?.length !== IV_BYTES || data === null) return yield* invalid("The file is damaged.");
    const plain = yield* Effect.tryPromise({
      try: async () =>
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
          await crypto.subtle.decrypt(
            { name: "AES-GCM", iv, additionalData: AAD },
            await importKey(raw, "decrypt"),
            data,
          ),
        ),
      catch: () =>
        new ArchiveInvalid({ reason: "The key does not open this file, or the file is damaged." }),
    });
    let payload: unknown;
    try {
      payload = JSON.parse(plain);
    } catch {
      return yield* invalid("The file is damaged.");
    }
    const tables = isRecord(payload) ? payload["tables"] : null;
    if (!isRecord(tables)) return yield* invalid("The file holds no records.");
    const result: Record<ArchiveTable, readonly ArchiveRow[]> = mapArchiveTables(() => []);
    for (const table of ARCHIVE_TABLES) {
      const rows: unknown = tables[table] ?? [];
      if (!Array.isArray(rows) || !rows.every(isRecord)) {
        return yield* invalid(`The rows of ${table} are not a list of records.`);
      }
      result[table] = rows;
    }
    return result;
  });

interface Planned {
  readonly label: string;
  readonly entry: ImportEntry;
}

/** The mounts an API Key's metadata limits it to. */
const scopeMounts = (metadata: unknown): string[] => {
  let value = metadata;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!isRecord(value) || value["paths"] === undefined) return [];
  const scope = parseScope(value["paths"]);
  return scope === null ? [] : [...new Set(scope.flatMap((root) => root.slice(0, 1)))];
};

/** The entries of an import, in the order the rows are written, each with the keys it uses. */
export const importEntries = (tables: ArchiveTables): Planned[] => [
  ...tables.user.map((row) => ({
    label: `user ${text(row, "email")}`,
    entry: { defines: [`user:${text(row, "id")}`, `email:${text(row, "email")}`], needs: [] },
  })),
  ...tables.account.map((row) => ({
    label: `login ${text(row, "id")}`,
    entry: { defines: [`account:${text(row, "id")}`], needs: [`user:${text(row, "user_id")}`] },
  })),
  ...tables.storage_backends.map((row) => ({
    label: `backend ${text(row, "name")}`,
    entry: {
      defines: [`backend:${text(row, "id")}`, `backend-name:${text(row, "name")}`],
      needs: [],
    },
  })),
  ...tables.mounts.map((row) => ({
    label: `Mount ${text(row, "name")}`,
    entry: {
      defines: [`mount:${text(row, "id")}`, `mount-name:${text(row, "name")}`],
      needs: [`backend:${text(row, "backend_id")}`],
    },
  })),
  ...tables.apikey.map((row) => ({
    label: `API Key ${text(row, "name") || text(row, "id")}`,
    entry: {
      defines: [`apikey:${text(row, "id")}`, `apikey-hash:${text(row, "key")}`],
      needs: [
        `user:${text(row, "reference_id")}`,
        ...scopeMounts(row["metadata"]).map((mount) => `mount-name:${mount}`),
      ],
    },
  })),
  ...tables.dav_properties.map((row) => ({
    label: `property ${text(row, "name")} of ${text(row, "path") || "/"}`,
    entry: { defines: [], needs: [`backend:${text(row, "backend_id")}`] },
  })),
  // A setting that names a backend the import leaves out falls back as an unset one does.
  ...tables.settings.map((row) => ({
    label: `setting ${text(row, "key")}`,
    entry: { defines: [`setting:${text(row, "key")}`], needs: [] },
  })),
];

/** The first entry an import cannot apply, and why, for the message of a rejected import. */
export const describeRejection = (
  planned: readonly Planned[],
  known: readonly string[],
): string => {
  const defined = new Set(known);
  const problems = planned.map(({ label, entry }) => {
    const missing = entry.needs.find((key) => !defined.has(key));
    const repeated = entry.defines.find(
      (key, index) => defined.has(key) || entry.defines.indexOf(key) < index,
    );
    for (const key of entry.defines) defined.add(key);
    if (missing !== undefined) return `The ${label} needs ${missing}, which nothing defines.`;
    return repeated === undefined
      ? null
      : `The ${label} repeats ${repeated}, which is defined already.`;
  });
  // planImport rejects only records that one of the rules above names.
  return problems.find((problem) => problem !== null) ?? "The records do not fit together.";
};

/**
 * The records with the deployment's default backend added, when the deployment names one and the
 * export holds no backend this runtime can open: a move from Workers to a self-hosted instance
 * brings Durable Object backends, and their Mounts can move to the new backend once its files are
 * copied.
 */
const withDefaultBackend = (
  tables: ArchiveTables,
  config: Context.Service.Shape<typeof InstanceConfig>,
): ArchiveTables => {
  const chosen = config.defaultBackend;
  const kinds = new Set(config.storageKinds);
  if (!chosen || tables.storage_backends.some((row) => kinds.has(text(row, "kind")))) return tables;
  const names = new Set(tables.storage_backends.map((row) => text(row, "name")));
  let name = "Default";
  for (let n = 2; names.has(name); n += 1) name = `Default ${n}`;
  const checked = chosen.kind === "s3" ? checkS3Config(chosen.config) : null;
  const now = Date.now();
  const row: ArchiveRow = {
    id: crypto.randomUUID(),
    name,
    kind: chosen.kind,
    config: checked?.ok ? checked.config : chosen.config,
    // Plain here; the import seals it like every other secret key.
    secret_key: chosen.secretKey ? Redacted.value(chosen.secretKey) : null,
    created_at: now,
    updated_at: now,
  };
  return { ...tables, storage_backends: [...tables.storage_backends, row] };
};

/**
 * Imports an export into an instance that has no user yet, in place of registering its owner. Every
 * record is written, or, when the file, the key or a record is invalid, none.
 */
export const importInstance = (input: { key: string; file: unknown; setupToken?: string }) =>
  Effect.gen(function* () {
    const records = yield* Records;
    const config = yield* InstanceConfig;
    const archive = yield* Archive;
    const cipher = yield* CredentialCipher;
    if ((yield* Effect.promise(() => records.users.count())) > 0) {
      return yield* Effect.fail(new RegistrationClosed());
    }
    yield* requireSetupToken(input.setupToken ?? "");
    const tables = withDefaultBackend(yield* openArchive(input.file, input.key), config);
    const problem = archive.check(tables);
    if (problem !== null) return yield* invalid(problem);
    // The import takes the place of registering the owner, so the export must bring exactly one
    // user who can sign in. Otherwise registration would stay open, and the first visitor would
    // become the owner of the imported backends and Mounts.
    const ownerLogins = tables.account.filter(
      (row) =>
        text(row, "user_id") === text(tables.user[0] ?? {}, "id") &&
        text(row, "provider_id") === "credential" &&
        text(row, "password") !== "",
    ).length;
    if (!exportHasOwner(tables.user.length, ownerLogins)) {
      return yield* invalid("The export must hold exactly one user who signs in with a password.");
    }
    const target = yield* Effect.promise(() => archive.read());
    const known = importEntries(target).flatMap(({ entry }) => entry.defines);
    const planned = importEntries(tables);
    if (
      planImport(
        planned.map(({ entry }) => entry),
        known,
      ) === "reject"
    ) {
      return yield* invalid(describeRejection(planned, known));
    }
    const backends: ArchiveRow[] = [];
    for (const row of tables.storage_backends) {
      const secret = row["secret_key"];
      backends.push(
        typeof secret === "string"
          ? { ...row, secret_key: yield* cipher.seal(text(row, "id"), Redacted.make(secret)) }
          : row,
      );
    }
    const written = yield* Effect.tryPromise({
      try: () => archive.write({ ...tables, storage_backends: backends }),
      catch: (error) => error,
    }).pipe(
      Effect.as(true),
      Effect.catch((error) => {
        // The database's message holds the rows' values, password hashes and sealed secrets too.
        console.error("Import failed to write:", redactedError(error));
        return Effect.succeed(false);
      }),
    );
    if (!written) {
      // A registration that won the race makes the database refuse every imported user.
      if ((yield* Effect.promise(() => records.users.count())) > 0) {
        return yield* Effect.fail(new RegistrationClosed());
      }
      return yield* invalid("The database refused the records, so nothing was imported.");
    }
    return Object.fromEntries(ARCHIVE_TABLES.map((table) => [table, tables[table].length]));
  });

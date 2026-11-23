import { and, count, eq, inArray, or, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";

// The records Davloom keeps in its SQL database, written once against Drizzle's SQLite dialect so
// the same queries run on D1 and on Bun SQLite.

// oxlint-disable-next-line typescript/no-explicit-any -- the run result differs between D1 and Bun SQLite
export type Database = BaseSQLiteDatabase<"async" | "sync", any, typeof schema>;

export interface BackendRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
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
}

export interface LockRecord {
  readonly token: string;
  readonly root: string;
  readonly depth: string;
  readonly scope: string;
  readonly owner: string;
  readonly timeout: number;
  readonly expiresAt: number;
}

const parseMetadata = (value: string | null): unknown => {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    // Better Auth has stored metadata stringified twice in older releases.
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    return null;
  }
};

const toApiKey = (row: typeof schema.apikey.$inferSelect): ApiKeyRecord => ({
  id: row.id,
  name: row.name,
  start: row.start,
  enabled: row.enabled ?? true,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
  metadata: parseMetadata(row.metadata),
});

/** Whether a SQL error is a unique constraint failure, on D1 or on Bun SQLite. */
export const isUniqueViolation = (error: unknown): boolean => {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (/UNIQUE constraint failed/i.test(current.message)) return true;
  }
  return false;
};

/**
 * Roots strictly under `key`: SQLite compares text as UTF-8 bytes, and every key that starts with
 * `key/` sorts from `key/` up to, not including, `key0`, since "0" follows "/".
 */
const strictlyUnder = (key: string) =>
  and(sql`${schema.davLocks.root} >= ${`${key}/`}`, sql`${schema.davLocks.root} < ${`${key}0`}`);

export const createRepositories = (db: Database) => ({
  users: {
    count: async () => (await db.select({ value: count() }).from(schema.user))[0]?.value ?? 0,
  },
  backends: {
    list: async (): Promise<BackendRecord[]> =>
      await db
        .select({
          id: schema.storageBackends.id,
          name: schema.storageBackends.name,
          kind: schema.storageBackends.kind,
          createdAt: schema.storageBackends.createdAt,
        })
        .from(schema.storageBackends)
        .orderBy(schema.storageBackends.createdAt),
    create: async (record: { id: string; name: string; kind: string; config: unknown }) => {
      const now = new Date();
      await db.insert(schema.storageBackends).values({ ...record, createdAt: now, updatedAt: now });
    },
  },
  mounts: {
    list: async (): Promise<MountRecord[]> =>
      await db
        .select({
          id: schema.mounts.id,
          name: schema.mounts.name,
          backendId: schema.mounts.backendId,
          backendKind: schema.storageBackends.kind,
          root: schema.mounts.root,
          createdAt: schema.mounts.createdAt,
        })
        .from(schema.mounts)
        .innerJoin(schema.storageBackends, eq(schema.mounts.backendId, schema.storageBackends.id))
        .orderBy(schema.mounts.name),
    create: async (record: { id: string; name: string; backendId: string; root: string }) => {
      const now = new Date();
      await db.insert(schema.mounts).values({ ...record, createdAt: now, updatedAt: now });
    },
    rename: async (id: string, name: string) =>
      (
        await db
          .update(schema.mounts)
          .set({ name, updatedAt: new Date() })
          .where(eq(schema.mounts.id, id))
          .returning({ id: schema.mounts.id })
      ).length > 0,
    remove: async (id: string) =>
      (
        await db
          .delete(schema.mounts)
          .where(eq(schema.mounts.id, id))
          .returning({ id: schema.mounts.id })
      ).length > 0,
  },
  apiKeys: {
    /** The key whose stored hash is `hash`. One read, and no write, per WebDAV request. */
    findByHash: async (hash: string): Promise<ApiKeyRecord | null> => {
      const row = (
        await db.select().from(schema.apikey).where(eq(schema.apikey.key, hash)).limit(1)
      )[0];
      return row ? toApiKey(row) : null;
    },
    list: async (): Promise<ApiKeyRecord[]> =>
      (await db.select().from(schema.apikey).orderBy(schema.apikey.createdAt)).map(toApiKey),
    remove: async (id: string) =>
      (
        await db
          .delete(schema.apikey)
          .where(eq(schema.apikey.id, id))
          .returning({ id: schema.apikey.id })
      ).length > 0,
  },
  locks: {
    /** Locks rooted at any of `roots`, or, with `under`, rooted under it. */
    find: async (
      roots: readonly string[],
      under: string | null,
      now: number,
    ): Promise<LockRecord[]> => {
      const rooted = inArray(schema.davLocks.root, [...roots]);
      const match =
        under === null ? rooted : or(rooted, under === "" ? sql`1 = 1` : strictlyUnder(under));
      return await db
        .select()
        .from(schema.davLocks)
        .where(and(match, sql`${schema.davLocks.expiresAt} > ${now}`));
    },
    create: async (lock: LockRecord) => {
      await db.insert(schema.davLocks).values(lock);
    },
    refresh: async (token: string, timeout: number, expiresAt: number, now: number) =>
      (
        await db
          .update(schema.davLocks)
          .set({ timeout, expiresAt })
          .where(and(eq(schema.davLocks.token, token), sql`${schema.davLocks.expiresAt} > ${now}`))
          .returning()
      )[0] ?? null,
    remove: async (token: string) =>
      (
        await db
          .delete(schema.davLocks)
          .where(eq(schema.davLocks.token, token))
          .returning({ token: schema.davLocks.token })
      ).length > 0,
    removeTree: async (root: string) => {
      await db
        .delete(schema.davLocks)
        .where(root === "" ? sql`1 = 1` : or(eq(schema.davLocks.root, root), strictlyUnder(root)));
    },
    /** Deletes expired locks; run now and then so the table stays small. */
    purge: async (now: number) => {
      await db.delete(schema.davLocks).where(sql`${schema.davLocks.expiresAt} <= ${now}`);
    },
  },
});

export type Repositories = ReturnType<typeof createRepositories>;

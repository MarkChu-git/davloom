import {
  fail,
  ok,
  pathKey,
  redactedError,
  type DeadProperty,
  type PropertyStore,
} from "@davloom/core";
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "./repositories";
import * as schema from "./schema";

// The Property Store Port on the instance database, for backends that cannot keep dead properties
// themselves. One store serves one backend: every query names its id. D1 has no interactive
// transactions, so each change is a single statement where it can be, and a patch deletes before it
// sets, so a failure between the two never leaves a property that was asked to go.

/** D1 binds at most 100 values per statement: paths or names per query, with the backend id. */
const BATCH = 90;
/** Rows per insert, at four values each. */
const ROWS = 24;

const t = schema.davProperties;

/**
 * `key` and every key under it. SQLite compares text as UTF-8 bytes, and every key that starts
 * with `key/` sorts from `key/` up to, not including, `key0`, since "0" follows "/".
 */
const tree = (key: string): SQL | undefined =>
  key === ""
    ? undefined
    : or(eq(t.path, key), and(sql`${t.path} >= ${`${key}/`}`, sql`${t.path} < ${`${key}0`}`));

/**
 * The path of a row under `from` moved under `to`. SQLite's `length` and `substr` both count
 * characters of the stored text, so the rest of the path is cut where `from` ends, whatever the
 * names hold.
 */
const moved = (from: string, to: string): SQL =>
  sql`${to} || substr(${t.path}, length(${from}) + 1)`;

const attempt = async <T>(run: () => Promise<T>) => {
  try {
    return ok(await run());
  } catch (error) {
    // The query's values are paths and dead property values, which the log must not hold.
    console.error("property store query failed:", redactedError(error));
    return fail<T>("unavailable");
  }
};

const chunks = <T>(items: readonly T[], size = BATCH): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

export const createSqlPropertyStore = (db: Database, backendId: string): PropertyStore => {
  const ofBackend = eq(t.backendId, backendId);
  const copyRows = async (fromKey: string, toKey: string) => {
    await db.run(
      sql`INSERT INTO dav_properties (backend_id, path, name, xml)
          SELECT backend_id, ${moved(fromKey, toKey)}, name, xml FROM dav_properties
          WHERE ${and(ofBackend, tree(fromKey))}
          ON CONFLICT (backend_id, path, name) DO UPDATE SET xml = excluded.xml`,
    );
  };
  return {
    get: (paths) =>
      attempt(async () => {
        const keys = [...new Set(paths.map(pathKey))];
        const result: Record<string, DeadProperty[]> = Object.fromEntries(
          keys.map((key) => [key, []]),
        );
        for (const batch of chunks(keys)) {
          const rows = await db
            .select({ path: t.path, name: t.name, xml: t.xml })
            .from(t)
            .where(and(ofBackend, inArray(t.path, batch)))
            .orderBy(asc(t.path), asc(t.name));
          for (const row of rows) result[row.path]?.push({ name: row.name, xml: row.xml });
        }
        return result;
      }),
    patch: (path, set, remove) =>
      attempt(async () => {
        const key = pathKey(path);
        for (const batch of chunks(remove)) {
          await db.delete(t).where(and(ofBackend, eq(t.path, key), inArray(t.name, batch)));
        }
        // As in the Port: the last of several sets of one name wins, and a removal follows them.
        const removed = new Set(remove);
        const kept = [...new Map(set.map((property) => [property.name, property])).values()].filter(
          (property) => !removed.has(property.name),
        );
        for (const batch of chunks(kept, ROWS)) {
          await db
            .insert(t)
            .values(
              batch.map((property) => ({
                backendId,
                path: key,
                name: property.name,
                xml: property.xml,
              })),
            )
            .onConflictDoUpdate({
              target: [t.backendId, t.path, t.name],
              set: { xml: sql`excluded.xml` },
            });
        }
        return null;
      }),
    copyTree: async (from, to) => {
      if (from.length === 0 || to.length === 0) return fail("root");
      return await attempt(async () => {
        await copyRows(pathKey(from), pathKey(to));
        return null;
      });
    },
    moveTree: async (from, to) => {
      if (from.length === 0 || to.length === 0) return fail("root");
      return await attempt(async () => {
        const fromKey = pathKey(from);
        const toKey = pathKey(to);
        // One statement: rows that land on a property the destination already has replace it.
        await db.run(
          sql`UPDATE OR REPLACE dav_properties SET path = ${moved(fromKey, toKey)}
              WHERE ${and(ofBackend, tree(fromKey))}`,
        );
        return null;
      });
    },
    removeTree: (path) =>
      attempt(async () => {
        await db.delete(t).where(and(ofBackend, tree(pathKey(path))));
        return null;
      }),
  };
};

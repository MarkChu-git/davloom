// Counts what one request costs on the Workers Free plan, at the bindings the production Worker
// reaches its infrastructure through: D1 statements and the rows D1 reports, calls on Durable Object
// stubs and the SQLite rows the objects report, and fetches to the internet. The domain code stays
// as it is; only the bindings it is handed are wrapped (PRD §11, Cloud Free quota check).

import type { Usage } from "./usage";

const empty = (): Usage => ({
  d1Queries: 0,
  d1Calls: 0,
  d1RowsRead: 0,
  d1RowsWritten: 0,
  objectCalls: 0,
  objectRowsRead: 0,
  objectRowsWritten: 0,
  externalFetches: 0,
});

/**
 * One meter for the isolate. Requests to the metered Worker run one at a time, and local workerd
 * runs a Worker's Durable Objects in the Worker's isolate, so the objects add to the same meter.
 */
let usage = empty();
// SQLite cursors count their rows as they are read, so they are added up when the usage is read.
let cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[] = [];

export const resetUsage = () => {
  usage = empty();
  cursors = [];
};

export const readUsage = (): Usage => ({
  ...usage,
  objectRowsRead: cursors.reduce((sum, cursor) => sum + cursor.rowsRead, 0),
  objectRowsWritten: cursors.reduce((sum, cursor) => sum + cursor.rowsWritten, 0),
});

const recordMeta = (meta: D1Meta) => {
  usage.d1Queries += 1;
  usage.d1RowsRead += meta.rows_read ?? 0;
  usage.d1RowsWritten += meta.rows_written ?? 0;
};

/**
 * A statement that reports its metadata. `raw()` and `first()` return none, so they run `all()` and
 * rebuild their answer from its rows, as the Cloud Free probe does (probe/d1-usage.workers.ts).
 */
class MeteredStatement {
  constructor(readonly inner: D1PreparedStatement) {}

  bind(...values: unknown[]) {
    return new MeteredStatement(this.inner.bind(...values));
  }

  async run() {
    usage.d1Calls += 1;
    const result = await this.inner.run();
    recordMeta(result.meta);
    return result;
  }

  async all() {
    usage.d1Calls += 1;
    const result = await this.inner.all();
    recordMeta(result.meta);
    return result;
  }

  async first(column?: string) {
    const [row] = (await this.all()).results;
    return (column ? row?.[column] : row) ?? null;
  }

  async raw(options?: { columnNames?: boolean }) {
    const rows = (await this.all()).results;
    const values = rows.map((row) => Object.values(row));
    return options?.columnNames ? [Object.keys(rows[0] ?? {}), ...values] : values;
  }
}

const isMetered = (value: unknown): value is MeteredStatement => value instanceof MeteredStatement;

/** Drizzle calls only `prepare` and `batch`; anything else fails loudly rather than unmetered. */
export const meteredD1 = (binding: D1Database): D1Database => {
  const database = {
    prepare: (query: string) => new MeteredStatement(binding.prepare(query)),
    batch: async (statements: unknown[]) => {
      usage.d1Calls += 1;
      const results = await binding.batch(
        statements.map((statement) => {
          if (!isMetered(statement)) throw new Error("a D1 batch got a statement it did not make");
          return statement.inner;
        }),
      );
      for (const result of results) recordMeta(result.meta);
      return results;
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the part of D1Database Drizzle calls
  return database as unknown as D1Database;
};

/** Counts every call on a stub, which is one Durable Object request. */
export const meteredNamespace = <T extends Rpc.DurableObjectBranded | undefined>(
  namespace: DurableObjectNamespace<T>,
): DurableObjectNamespace<T> =>
  new Proxy(namespace, {
    get: (target, property) => {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (property !== "get" && property !== "getByName") return value.bind(target);
      return (...args: unknown[]) => {
        const stub: unknown = Reflect.apply(value, target, args);
        if (typeof stub !== "object" || stub === null) return stub;
        return new Proxy(stub, {
          get: (inner, name) => {
            const method: unknown = Reflect.get(inner, name, inner);
            if (typeof method !== "function") return method;
            return (...callArgs: unknown[]): unknown => {
              usage.objectCalls += 1;
              return Reflect.apply(method, inner, callArgs);
            };
          },
        });
      };
    },
  });

/** Keeps each cursor the object's SQLite storage hands out, to add up its rows later. */
export const meteredSql = (sql: SqlStorage): SqlStorage =>
  new Proxy(sql, {
    get: (target, property) => {
      const value: unknown = Reflect.get(target, property, target);
      if (property !== "exec" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (...args: unknown[]) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- exec returns a cursor
        const cursor = Reflect.apply(value, target, args) as SqlStorageCursor<
          Record<string, SqlStorageValue>
        >;
        cursors.push(cursor);
        return cursor;
      };
    },
  });

/** Counts fetches to the internet, which S3 backends make. */
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const meteredFetch =
  (inner: Fetch): Fetch =>
  async (input, init) => {
    usage.externalFetches += 1;
    return await inner(input, init);
  };

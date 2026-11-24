// A Durable Object's SQLite storage on an SQLite engine the caller passes in, so the Durable Objects
// adapter runs with the unit tests on Bun (bun:sqlite) as well as in workerd (test:storage). It holds
// only what the adapter calls: `sql.exec(...).toArray()`, `sql.databaseSize`, `transactionSync`,
// `deleteAll` and `blockConcurrencyWhile`. The workerd run stays the reference for the platform's
// own behavior; this one runs the same contract with coverage.

/** The part of bun:sqlite's `Database` the stand-in uses. */
export interface SqliteEngine {
  query(sql: string): { all(...bindings: unknown[]): unknown[] };
  exec(sql: string): void;
  transaction<T>(run: () => T): () => T;
}

type Row = Record<string, SqlStorageValue>;

/** workerd hands a BLOB back as an ArrayBuffer; bun:sqlite gives a Uint8Array. */
const toStorageValue = (value: unknown): SqlStorageValue => {
  if (value instanceof Uint8Array) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy.buffer;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQLite gives null, numbers and strings otherwise
  return value as SqlStorageValue;
};

/** bun:sqlite binds typed arrays, not a bare ArrayBuffer. */
const toBinding = (value: SqlStorageValue): unknown =>
  value instanceof ArrayBuffer ? new Uint8Array(value) : value;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Statements separated by semicolons: the schema runs as one script, as `exec` allows. */
const isScript = (query: string) => query.trim().replace(/;\s*$/, "").includes(";");

export const sqliteObjectState = (engine: SqliteEngine): DurableObjectState => {
  const exec = (query: string, ...bindings: SqlStorageValue[]) => {
    let rows: Row[] = [];
    if (isScript(query) && bindings.length === 0) {
      engine.exec(query);
    } else {
      rows = engine
        .query(query)
        .all(...bindings.map(toBinding))
        .filter(isRecord)
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, toStorageValue(value)]),
          ),
        );
    }
    return { toArray: () => rows };
  };
  const pragma = (name: string) => {
    const [row] = engine.query(`PRAGMA ${name}`).all();
    const value: unknown = isRecord(row) ? row[name] : 0;
    return typeof value === "number" ? value : 0;
  };
  const sql = {
    exec,
    get databaseSize() {
      return pragma("page_count") * pragma("page_size");
    },
  };
  const storage = {
    sql,
    transactionSync: <T>(run: () => T): T => engine.transaction(run)(),
    deleteAll: () => {
      const tables = engine
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all();
      for (const table of tables) {
        if (isRecord(table) && typeof table.name === "string") {
          engine.exec(`DROP TABLE IF EXISTS "${table.name}"`);
        }
      }
      return Promise.resolve();
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the part of DurableObjectState the adapter uses
  return {
    storage,
    blockConcurrencyWhile: async <T>(run: () => Promise<T>) => await run(),
  } as unknown as DurableObjectState;
};

/**
 * A namespace whose objects live in this process, one per name, each on a fresh engine. A stub's
 * method answers with a promise, as Workers RPC does.
 */
export const localNamespace = <T extends object>(
  make: (state: DurableObjectState) => T,
  engine: () => SqliteEngine,
): DurableObjectNamespace<T & Rpc.DurableObjectBranded> => {
  const objects = new Map<string, T>();
  const objectOf = (name: string) => {
    let object = objects.get(name);
    if (!object) {
      object = make(sqliteObjectState(engine()));
      objects.set(name, object);
    }
    return object;
  };
  const stubOf = (name: string) =>
    new Proxy(
      {},
      {
        get: (_, method) => {
          const object = objectOf(name);
          const value: unknown = Reflect.get(object, method);
          if (typeof value !== "function") return value;
          return async (...args: unknown[]): Promise<unknown> =>
            await Reflect.apply(value, object, args);
        },
      },
    );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the part of the namespace the adapter uses
  return {
    idFromName: (name: string) => ({ name, toString: () => name }),
    get: (id: { name: string }) => stubOf(id.name),
  } as unknown as DurableObjectNamespace<T & Rpc.DurableObjectBranded>;
};

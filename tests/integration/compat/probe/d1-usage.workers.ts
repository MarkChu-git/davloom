export interface D1Usage {
  readonly queries: number;
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

export interface D1UsageCounter {
  readonly database: D1Database;
  read(): D1Usage;
  reset(): void;
}

type RecordMeta = (meta: D1Meta) => void;

/**
 * Drizzle reads typed rows with `raw()`, which returns no metadata, so this statement runs `all()`
 * instead and rebuilds the arrays. Rows keep their column order, which is all that Drizzle needs
 * for the probe's queries.
 */
class CountingStatement {
  constructor(
    readonly inner: D1PreparedStatement,
    private readonly record: RecordMeta,
  ) {}

  bind(...values: unknown[]) {
    return new CountingStatement(this.inner.bind(...values), this.record);
  }

  async run() {
    const result = await this.inner.run();
    this.record(result.meta);
    return result;
  }

  async all() {
    const result = await this.inner.all();
    this.record(result.meta);
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

/** Wraps a D1 binding and adds up the rows that D1 itself reports having read and written. */
export const countD1Usage = (binding: D1Database): D1UsageCounter => {
  let usage: D1Usage = { queries: 0, rowsRead: 0, rowsWritten: 0 };
  const record: RecordMeta = (meta) => {
    usage = {
      queries: usage.queries + 1,
      rowsRead: usage.rowsRead + (meta.rows_read ?? 0),
      rowsWritten: usage.rowsWritten + (meta.rows_written ?? 0),
    };
  };

  const database = {
    prepare: (query: string) => new CountingStatement(binding.prepare(query), record),
    batch: async (statements: CountingStatement[]) => {
      const results = await binding.batch(statements.map((statement) => statement.inner));
      for (const result of results) {
        record(result.meta);
      }
      return results;
    },
  };

  return {
    // Drizzle calls only prepare and batch, so this stand-in implements just those two methods.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    database: database as unknown as D1Database,
    read: () => usage,
    reset: () => {
      usage = { queries: 0, rowsRead: 0, rowsWritten: 0 };
    },
  };
};

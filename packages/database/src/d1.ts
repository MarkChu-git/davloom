import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/** The structural part of a D1 binding, so this module does not need Workers types. */
type D1Binding = Parameters<typeof drizzle>[0];

export const createD1Database = (binding: D1Binding) => drizzle(binding, { schema });

/** Runs statements in one D1 batch, which D1 applies as one transaction. */
export const d1Atomic =
  (db: ReturnType<typeof createD1Database>) =>
  async (statements: readonly { run: () => unknown }[]): Promise<void> => {
    // The archive passes at least one statement, each a Drizzle query of this database.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  };

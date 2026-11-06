import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/** The structural part of a D1 binding, so this module does not need Workers types. */
type D1Binding = Parameters<typeof drizzle>[0];

export const createD1Database = (binding: D1Binding) => drizzle(binding, { schema });

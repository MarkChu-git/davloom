import * as schema from "@davloom/database/schema";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

/** The table of the schema the code runs with, by its name in SQL. */
export const schemaTable = (name: string): SQLiteTable => {
  for (const value of Object.values(schema)) {
    if (is(value, SQLiteTable) && getTableName(value) === name) return value;
  }
  throw new Error(`the schema has no table ${name}`);
};

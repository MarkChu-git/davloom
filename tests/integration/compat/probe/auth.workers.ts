import { createAuth, type Auth } from "@davloom/auth";
import { createD1Database } from "@davloom/database/d1";

export interface ProbeEnv {
  readonly AUTH_SECRET: string;
  readonly DB: D1Database;
  readonly PROBE_TOKEN: string;
  readonly STORE: DurableObjectNamespace;
}

export const createProbeAuth = (binding: D1Database, secret: string): Auth =>
  createAuth({
    database: createD1Database(binding),
    secret,
    baseURL: "https://probe.davloom.test",
  });

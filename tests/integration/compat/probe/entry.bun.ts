import { Database } from "bun:sqlite";
import { createAuth } from "@davloom/auth";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "@davloom/database/bun-sqlite";
import { createProbeApp } from "./app";

// Bun rejects request bodies above 128 MiB unless told otherwise.
const MAX_REQUEST_BODY_BYTES = 2 ** 40;

const database = createBunSqliteDatabase(new Database(":memory:"));
migrateBunSqliteDatabase(database);

const auth = createAuth({
  database,
  secret: "compatibility-test-secret-not-used-anywhere-else",
  baseURL: "http://localhost",
});

const app = createProbeApp({ getAuth: () => auth })
  // maxRSS is the high-water mark since the process started, reported in KiB.
  .get("/api/__probe/memory", () => ({
    residentBytes: process.memoryUsage().rss,
    peakResidentBytes: process.resourceUsage().maxRSS * 1024,
  }))
  .listen({
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    hostname: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 0),
  });

console.log(`listening on ${app.server?.url}`);

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ADMIN,
  basic,
  SECRET,
  SETUP_TOKEN,
  startDavloom,
  startWorkersServer,
  stringField,
} from "./davloom";
import { startBunServer, type Server } from "./servers";

// Moving an instance with its export (PRD §7 Data Migration): from Workers with D1 to Bun with
// SQLite, and from there back to a new Workers instance. The administrator signs in with the same
// password and the API Keys keep working after each move.

const servers: Server[] = [];
afterAll(async () => {
  for (const server of servers) await server.stop();
});

const startBun = async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "davloom-migration-"));
  const server = await startBunServer("apps/api/src/entry.bun.ts", {
    DAVLOOM_SECRET: `${SECRET}-bun`,
    DAVLOOM_SETUP_TOKEN: SETUP_TOKEN,
    DAVLOOM_DATA_DIR: dataDir,
  });
  return {
    ...server,
    stop: async () => {
      await server.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
};

const json = { "content-type": "application/json" };

const signIn = async (server: Server) => {
  const response = await server.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { ...json, origin: server.url },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  expect(response.ok).toBe(true);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return (path: string, init: RequestInit = {}) =>
    server.fetch(path, { ...init, headers: { ...json, origin: server.url, cookie } });
};

const exportOf = async (api: (path: string, init?: RequestInit) => Promise<Response>) => {
  const response = await api("/api/export", { method: "POST" });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  const file: unknown =
    typeof body === "object" && body !== null ? Reflect.get(body, "file") : undefined;
  return { key: stringField(body, "key"), file };
};

const importInto = (server: Server, body: { key: string; file: unknown }, token = SETUP_TOKEN) =>
  server.fetch("/api/setup/import", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ ...body, token }),
  });

const keysOf = async (api: (path: string) => Promise<Response>) => {
  const keys: unknown = await (await api("/api/keys")).json();
  return keys;
};

describe("moving an instance", () => {
  it("from Workers to Bun and back keeps the administrator, the Mounts and the keys", async () => {
    const source = await startDavloom();
    servers.push(source.server);
    const scoped = await source.api("/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "camera", access: "read-write", paths: ["/files/upload"] }),
    });
    expect(scoped.status).toBe(201);
    const scopedKey = stringField(await scoped.json(), "key");
    const sourceKeys = await keysOf(source.api);
    const sourceMounts: unknown = await (await source.api("/api/mounts")).json();

    // Workers (D1) to Bun (SQLite).
    const exported = await exportOf(source.api);
    expect(JSON.stringify(exported.file)).not.toContain(ADMIN.email);
    const bun = await startBun();
    servers.push(bun);
    expect((await importInto(bun, exported, "wrong token")).status).toBe(403);
    const imported = await importInto(bun, exported);
    expect(imported.status).toBe(201);
    expect(await (await bun.fetch("/api/setup")).json()).toEqual({ needed: false, open: false });
    const bunApi = await signIn(bun);
    expect(await keysOf(bunApi)).toEqual(sourceKeys);
    expect(await (await bunApi("/api/mounts")).json()).toEqual(sourceMounts);
    // The keys authenticate; the Durable Objects backend does not run on Bun, so the namespace
    // lists no Mount until the files move.
    for (const key of [source.readWriteKey, source.readOnlyKey, scopedKey]) {
      const response = await bun.fetch("/dav/", {
        method: "PROPFIND",
        headers: { authorization: basic(key), depth: "0" },
      });
      expect(response.status).toBe(207);
    }
    expect(
      (await bun.fetch("/dav/", { method: "PROPFIND", headers: { authorization: basic("dav_x") } }))
        .status,
    ).toBe(401);
    // A second import is refused, and changes nothing.
    expect((await importInto(bun, exported)).status).toBe(409);

    // Bun (SQLite) to a new Workers instance (D1).
    const again = await exportOf(bunApi);
    const workers = await startWorkersServer();
    servers.push(workers);
    expect((await importInto(workers, again)).status).toBe(201);
    const workersApi = await signIn(workers);
    expect(await keysOf(workersApi)).toEqual(sourceKeys);
    const put = await workers.fetch("/dav/files/moved.txt", {
      method: "PUT",
      headers: { authorization: basic(source.readWriteKey) },
      body: "moved",
    });
    expect(put.status).toBe(201);
    const outside = await workers.fetch("/dav/files/other.txt", {
      method: "PUT",
      headers: { authorization: basic(scopedKey) },
      body: "x",
    });
    expect(outside.status).toBe(403);
  });

  it("refuses a file whose key does not open it, and stays open for setup", async () => {
    const source = await startDavloom();
    servers.push(source.server);
    const { file } = await exportOf(source.api);
    const bun = await startBun();
    servers.push(bun);
    const response = await importInto(bun, { key: `dvx_${"A".repeat(43)}`, file });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "archive_invalid",
        message: "The key does not open this file, or the file is damaged.",
      },
    });
    expect(await (await bun.fetch("/api/setup")).json()).toEqual({ needed: true, open: true });
  });

  it("exports only for a signed-in administrator", async () => {
    const bun = await startBun();
    servers.push(bun);
    expect((await bun.fetch("/api/export", { method: "POST" })).status).toBe(401);
  });
});

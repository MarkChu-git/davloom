import { Database } from "bun:sqlite";
import { createAdmin, createAuth, createIdentity } from "@davloom/auth";
import {
  Archive,
  createMemoryStorage,
  createOperationRecorder,
  credentialCipherLayer,
  Identity,
  InstanceConfig,
  InstanceSettings,
  OperationLog,
  Records,
  StorageOpener,
  type OperationRecorder,
  type StorageBackend,
} from "@davloom/core";
import { createArchive } from "@davloom/database/archive";
import {
  bunSqliteAtomic,
  createBunSqliteDatabase,
  migrateBunSqliteDatabase,
} from "@davloom/database/bun-sqlite";
import { createOperationLog, createSettingsStore } from "@davloom/database/instance-data";
import { createRepositories } from "@davloom/database/repositories";
import { Layer, Redacted } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, DASHBOARD_HEADER, type Instance } from "./app";
import { createSqlLockStore } from "./locks";

// The management API's routes for the Overview's operations, backend changes and checks, the
// storage settings and About this instance, on an in-memory Bun SQLite database.

const ORIGIN = "https://davloom.test";
const SECRET = "instance-routes-test-secret-0123456789ab";
const ADMIN = { name: "Admin", email: "admin@davloom.test", password: "correct horse battery" };

const S3_CONFIG = {
  endpoint: "https://s3.example.com",
  region: "eu-west-1",
  bucket: "photos",
  prefix: "",
  forcePathStyle: true,
  accessKeyId: "AKIA1",
};

const world = async () => {
  const db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  const repositories = createRepositories(db);
  const auth = createAuth({ database: db, secret: SECRET, baseURL: ORIGIN });
  await createAdmin(auth, ADMIN);
  const storages = new Map<string, StorageBackend>();
  const log = createOperationLog(db, bunSqliteAtomic(db));
  let recorder: OperationRecorder | undefined;
  const instance = (): Instance => {
    recorder = createOperationRecorder({
      write: log.add,
      schedule: () => undefined,
      wait: () => new Promise<void>(() => undefined),
    });
    return {
      layer: Layer.mergeAll(
        Layer.succeed(Records, repositories),
        Layer.succeed(Archive, createArchive(db, bunSqliteAtomic(db))),
        Layer.succeed(Identity, createIdentity(auth)),
        Layer.succeed(StorageOpener, {
          open: (backend) => {
            if (backend.kind !== "memory" && backend.kind !== "s3") return null;
            let storage = storages.get(backend.id);
            if (!storage) {
              storage = createMemoryStorage({ capacity: 1000 });
              storages.set(backend.id, storage);
            }
            return storage;
          },
        }),
        Layer.succeed(InstanceConfig, { setupToken: null, storageKinds: ["memory", "s3"] }),
        credentialCipherLayer(Redacted.make(SECRET)),
        Layer.succeed(OperationLog, log),
        Layer.succeed(InstanceSettings, createSettingsStore(db)),
      ),
      authHandler: (request) => auth.handler(request),
      locks: createSqlLockStore(repositories.locks),
      operations: { record: (sample) => recorder?.record(sample) },
      about: () => ({
        runtime: "Bun 1.4.4",
        deployment: "Self-hosted",
        region: "Asia/Tokyo",
        database: "SQLite 3.51.0",
      }),
    };
  };
  const app = createApp({ instance });
  const fetch = (path: string, init: RequestInit = {}) =>
    app.handle(new Request(`${ORIGIN}${path}`, init));
  const signedIn = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  const cookie = signedIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const api = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const json: unknown = text === "" ? null : JSON.parse(text);
    return { status: response.status, json };
  };
  const dav = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set(DASHBOARD_HEADER, "1");
    headers.set("cookie", cookie);
    return fetch(`/dav${path}`, { ...init, headers });
  };
  const flush = async () => await recorder?.flush();
  return { api, dav, fetch, flush, repositories };
};

type World = Awaited<ReturnType<typeof world>>;

/** A string field of a JSON object, or a failed test. */
const field = (value: unknown, name: string): string => {
  const found: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
  if (typeof found !== "string") throw new Error(`no ${name} in ${JSON.stringify(value)}`);
  return found;
};

const created = async (w: World, body: Record<string, unknown>) => {
  const response = await w.api("/api/backends", "POST", body);
  expect(response.status).toBe(201);
  return field(response.json, "id");
};

let w: World;
beforeEach(async () => {
  w = await world();
});

describe("auth", () => {
  it.each([
    ["GET", "/api/operations"],
    ["POST", "/api/backends/check"],
    ["POST", "/api/backends/x/verify"],
    ["PATCH", "/api/backends/x"],
    ["DELETE", "/api/backends/x"],
    ["GET", "/api/settings/storage"],
    ["PUT", "/api/settings/storage"],
    ["GET", "/api/instance"],
  ])("refuses %s %s without a session", async (method, path) => {
    const response = await w.fetch(path, { method, headers: { origin: ORIGIN } });
    expect(response.status).toBe(401);
  });
});

describe("/api/operations", () => {
  it("counts WebDAV operations per hour, with failures and their errors", async () => {
    const backendId = await created(w, { name: "Mem", kind: "memory" });
    expect(
      (await w.api("/api/mounts", "POST", { name: "files", backendId, root: "" })).status,
    ).toBe(201);
    expect((await w.dav("/files/a.txt", { method: "PUT", body: "hi" })).status).toBe(201);
    expect((await w.dav("/files/missing.txt", { method: "GET" })).status).toBe(404);
    expect((await w.dav("/files/missing.txt", { method: "DELETE" })).status).toBe(404);
    expect(
      (
        await w.dav("/files/a.txt", {
          method: "COPY",
          headers: { destination: `${ORIGIN}/dav/files/a%20copy.txt` },
        })
      ).status,
    ).toBe(201);
    await w.flush();
    const { status, json } = await w.api("/api/operations");
    expect(status).toBe(200);
    const hours: unknown = Reflect.get(Object(json), "hours");
    expect(Array.isArray(hours) ? hours.length : 0).toBe(24);
    expect(Array.isArray(hours) ? hours.at(-1) : null).toMatchObject({ operations: 4, failed: 1 });
    expect(json).toMatchObject({
      errors: [{ method: "DELETE", path: "/files/missing.txt", status: 404 }],
    });
  });

  it("records the destination of a failed MOVE", async () => {
    const backendId = await created(w, { name: "Mem", kind: "memory" });
    await w.api("/api/mounts", "POST", { name: "files", backendId, root: "" });
    await w.dav("/files/a", { method: "PUT", body: "1" });
    await w.dav("/files/b", { method: "PUT", body: "2" });
    const moved = await w.dav("/files/a", {
      method: "MOVE",
      headers: { destination: `${ORIGIN}/dav/files/b`, overwrite: "F" },
    });
    expect(moved.status).toBe(412);
    await w.flush();
    expect((await w.api("/api/operations")).json).toMatchObject({
      errors: [{ destination: "/files/b", status: 412 }],
    });
  });
});

describe("backends", () => {
  it("lists an S3 backend's configuration without its secret, and edits it", async () => {
    const id = await created(w, {
      name: "S3",
      kind: "s3",
      config: S3_CONFIG,
      secretKey: "super-secret-value",
    });
    const listed = await w.api("/api/backends");
    expect(JSON.stringify(listed.json)).not.toContain("super-secret-value");
    expect(listed.json).toEqual([
      expect.objectContaining({ id, config: S3_CONFIG, hasSecretKey: true, capacity: 1000 }),
    ]);
    const edited = await w.api(`/api/backends/${id}`, "PATCH", {
      name: "Photos",
      config: { ...S3_CONFIG, bucket: "albums" },
    });
    expect(edited).toEqual({ status: 200, json: { id } });
    expect((await w.api("/api/backends")).json).toMatchObject([
      { name: "Photos", config: { bucket: "albums" } },
    ]);
    const stored = await w.repositories.backends.list();
    expect(stored[0]?.secretKey).not.toBeNull();
    expect(stored[0]?.secretKey).not.toContain("super-secret-value");
  });

  it.each([
    ["an unknown backend", "nope", { name: "x" }, 404, "not_found"],
    ["an empty name", "own", { name: "" }, 400, "invalid_input"],
  ])("refuses to edit %s", async (_, which, body, status, code) => {
    const id = await created(w, { name: "Mem", kind: "memory" });
    const response = await w.api(`/api/backends/${which === "own" ? id : which}`, "PATCH", body);
    expect(response).toEqual({ status, json: { error: { code } } });
  });

  it("verifies one backend and checks them all", async () => {
    const id = await created(w, { name: "Mem", kind: "memory" });
    const verified = await w.api(`/api/backends/${id}/verify`, "POST");
    expect(verified.status).toBe(200);
    expect(verified.json).toMatchObject({ id, available: true, reason: null });
    const checked = await w.api("/api/backends/check", "POST");
    expect(checked.json).toEqual([expect.objectContaining({ id, available: true })]);
    expect((await w.api("/api/backends/nope/verify", "POST")).status).toBe(404);
  });

  it("removes a backend no mount uses, and refuses one a mount uses", async () => {
    const used = await created(w, { name: "Used", kind: "memory" });
    const spare = await created(w, {
      name: "Spare",
      kind: "s3",
      config: S3_CONFIG,
      secretKey: "s",
    });
    await w.api("/api/mounts", "POST", { name: "files", backendId: used, root: "" });
    expect(await w.api(`/api/backends/${used}`, "DELETE")).toEqual({
      status: 409,
      json: { error: { code: "backend_in_use" } },
    });
    expect(await w.api(`/api/backends/${spare}`, "DELETE")).toEqual({
      status: 200,
      json: { id: spare, filesKept: true },
    });
    expect((await w.api("/api/backends")).json).toHaveLength(1);
    expect((await w.api(`/api/backends/${spare}`, "DELETE")).status).toBe(404);
  });
});

describe("/api/settings/storage", () => {
  it("names the first backend until another is saved, and refuses an unknown one", async () => {
    expect(await w.api("/api/settings/storage")).toEqual({
      status: 200,
      json: { defaultBackendId: null },
    });
    const first = await created(w, { name: "A", kind: "memory" });
    const second = await created(w, { name: "B", kind: "memory" });
    expect((await w.api("/api/settings/storage")).json).toEqual({ defaultBackendId: first });
    expect(await w.api("/api/settings/storage", "PUT", { defaultBackendId: second })).toEqual({
      status: 200,
      json: { defaultBackendId: second },
    });
    expect((await w.api("/api/settings/storage")).json).toEqual({ defaultBackendId: second });
    expect((await w.api("/api/settings/storage", "PUT", { defaultBackendId: "x" })).status).toBe(
      400,
    );
  });
});

describe("/api/instance", () => {
  it("names the version, the commit and where the instance runs", async () => {
    const { status, json } = await w.api("/api/instance");
    expect(status).toBe(200);
    expect(json).toEqual({
      version: "0.0.0",
      commit: process.env.DAVLOOM_COMMIT?.trim() || null,
      runtime: "Bun 1.4.4",
      deployment: "Self-hosted",
      region: "Asia/Tokyo",
      database: "SQLite 3.51.0",
      storageKinds: ["memory", "s3"],
    });
  });
});

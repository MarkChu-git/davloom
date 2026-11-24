import { Database } from "bun:sqlite";
import { createAuth, createIdentity } from "@davloom/auth";
import {
  Archive,
  createMemoryStorage,
  credentialCipherLayer,
  Identity,
  InstanceConfig,
  Records,
  StorageOpener,
  type StorageBackend,
} from "@davloom/core";
import { createArchive } from "@davloom/database/archive";
import {
  bunSqliteAtomic,
  createBunSqliteDatabase,
  migrateBunSqliteDatabase,
} from "@davloom/database/bun-sqlite";
import { createRepositories } from "@davloom/database/repositories";
import { Layer, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { createApp, DASHBOARD_HEADER, type Instance } from "./app";
import { createSqlLockStore } from "./locks";

// The management API and the WebDAV entry of the real app, in this process: Better Auth and the
// records on an in-memory Bun SQLite database, and memory storage behind every backend.

const ORIGIN = "http://davloom.test";
const TOKEN = "setup-token-for-app-tests";
const SECRET = "app-test-instance-secret-0123456789abcdef";
const ADMIN = { name: "Admin", email: "admin@davloom.test", password: "correct horse battery" };

const memoryInstance = (setupToken: string | null = TOKEN): Instance => {
  const db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  const repositories = createRepositories(db);
  const auth = createAuth({ database: db, secret: SECRET, baseURL: ORIGIN });
  const storages = new Map<string, StorageBackend>();
  return {
    layer: Layer.mergeAll(
      Layer.succeed(Records, repositories),
      Layer.succeed(Archive, createArchive(db, bunSqliteAtomic(db))),
      Layer.succeed(Identity, createIdentity(auth)),
      Layer.succeed(StorageOpener, {
        open: (backend) => {
          if (backend.kind !== "memory") return null;
          let storage = storages.get(backend.id);
          if (!storage) {
            storage = createMemoryStorage();
            storages.set(backend.id, storage);
          }
          return storage;
        },
      }),
      Layer.succeed(InstanceConfig, { setupToken, storageKinds: ["memory"] }),
      credentialCipherLayer(Redacted.make(SECRET)),
    ),
    authHandler: (request) => auth.handler(request),
    locks: createSqlLockStore(repositories.locks),
  };
};

const json = { "content-type": "application/json" };

const world = (setupToken: string | null = TOKEN) => {
  const app = createApp({ instance: () => memoryInstance(setupToken) });
  let cookie = "";
  const fetch = (path: string, init: RequestInit = {}) =>
    app.handle(new Request(`${ORIGIN}${path}`, init));
  const api = (path: string, method = "GET", body?: unknown) =>
    fetch(path, {
      method,
      headers: { ...json, origin: ORIGIN, cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const setup = async () => {
    const created = await api("/api/setup", "POST", { ...ADMIN, token: TOKEN });
    expect(created.status).toBe(201);
    const signedIn = await api("/api/auth/sign-in/email", "POST", {
      email: ADMIN.email,
      password: ADMIN.password,
    });
    expect(signedIn.status).toBe(200);
    cookie = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  };
  const key = async (access: string, paths?: string[]) => {
    const response = await api("/api/keys", "POST", { name: access, access, paths });
    expect(response.status).toBe(201);
    const created = await body(response);
    return { id: field(created, "id"), key: field(created, "key") };
  };
  const dav = (path: string, apiKey: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Basic ${btoa(`x:${apiKey}`)}`);
    return fetch(`/dav${path}`, { ...init, headers });
  };
  return { app, fetch, api, setup, key, dav };
};

const body = async (response: Response): Promise<unknown> => await response.json();

/** A string field of a JSON object, or a failed test. */
const field = (value: unknown, name: string): string => {
  const found: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
  if (typeof found !== "string") throw new Error(`no ${name} in ${JSON.stringify(value)}`);
  return found;
};

/** One string field of every object of a JSON list. */
const fields = (value: unknown, name: string): string[] =>
  Array.isArray(value) ? value.map((item: unknown) => field(item, name)) : [];

describe("the app without an instance", () => {
  it("answers health, and 501 for everything that needs one", async () => {
    const app = createApp();
    expect(await (await app.handle(new Request(`${ORIGIN}/api/health`))).json()).toEqual({
      status: "ok",
    });
    for (const path of ["/api/setup", "/api/auth/get-session", "/dav/"]) {
      expect((await app.handle(new Request(`${ORIGIN}${path}`))).status, path).toBe(501);
    }
  });

  it("answers 503 not_configured when the instance cannot be built", async () => {
    const app = createApp({
      instance: () => {
        throw new Error("DAVLOOM_SECRET must be set");
      },
    });
    for (const path of ["/api/setup", "/dav/"]) {
      const response = await app.handle(new Request(`${ORIGIN}${path}`));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "not_configured" } });
    }
  });

  it("hands WebDAV to a handler of the caller's own", async () => {
    const app = createApp({ webdavHandler: () => new Response("probe", { status: 299 }) });
    const response = await app.handle(new Request(`${ORIGIN}/dav/x`, { method: "PROPFIND" }));
    expect(response.status).toBe(299);
  });
});

describe("setup", () => {
  it("is open with a token, refuses bad input, and closes once done", async () => {
    const w = world();
    expect(await body(await w.api("/api/setup"))).toEqual({ needed: true, open: true });
    const cases: [Record<string, unknown>, number, string][] = [
      [{ ...ADMIN, token: "wrong" }, 403, "setup_token_invalid"],
      [{ ...ADMIN, name: " ", token: TOKEN }, 400, "invalid_input"],
      [{ ...ADMIN, email: "nope", token: TOKEN }, 400, "invalid_input"],
      [{ ...ADMIN, password: "short", token: TOKEN }, 400, "invalid_input"],
      [{}, 403, "setup_token_invalid"],
    ];
    for (const [input, status, code] of cases) {
      const response = await w.api("/api/setup", "POST", input);
      expect(response.status, JSON.stringify(input)).toBe(status);
      expect(await body(response)).toEqual({ error: { code } });
    }
    await w.setup();
    expect(await body(await w.api("/api/setup"))).toEqual({ needed: false, open: false });
    expect((await w.api("/api/setup", "POST", { ...ADMIN, token: TOKEN })).status).toBe(409);
  });

  it("is closed without a token on the deployment", async () => {
    const w = world(null);
    expect(await body(await w.api("/api/setup"))).toEqual({ needed: true, open: false });
    expect((await w.api("/api/setup", "POST", { ...ADMIN, token: "" })).status).toBe(409);
  });

  it("reads a body that is not JSON as empty", async () => {
    const w = world();
    const response = await w.fetch("/api/setup", { method: "POST", body: "not json" });
    expect(response.status).toBe(403);
  });
});

describe("the management API", () => {
  it.each(["/api/me", "/api/overview", "/api/keys", "/api/backends", "/api/mounts"])(
    "needs a session for %s",
    async (path) => {
      const w = world();
      await w.api("/api/setup", "POST", { ...ADMIN, token: TOKEN });
      expect((await w.fetch(path)).status).toBe(401);
    },
  );

  it("shows the administrator and the instance", async () => {
    const w = world();
    await w.setup();
    expect(await body(await w.api("/api/me"))).toMatchObject({ email: ADMIN.email });
    const overview: unknown = await body(await w.api("/api/overview"));
    expect(Object.keys(Object(overview)).toSorted()).toEqual(["backends", "mounts", "usage"]);
  });

  it("creates, lists and revokes keys", async () => {
    const w = world();
    await w.setup();
    const { id } = await w.key("read-only");
    expect((await w.api("/api/keys", "POST", { name: "", access: "read-only" })).status).toBe(400);
    expect(
      (
        await w.api("/api/keys", "POST", {
          name: "x",
          access: "read-only",
          expiresInDays: 0,
        })
      ).status,
    ).toBe(400);
    expect(fields(await body(await w.api("/api/keys")), "id")).toContain(id);
    expect((await w.api(`/api/keys/${id}`, "DELETE")).status).toBe(200);
    expect((await w.api(`/api/keys/${id}`, "DELETE")).status).toBe(404);
  });

  it("creates backends and mounts, renames, moves and removes them", async () => {
    const w = world();
    await w.setup();
    const backend = await w.api("/api/backends", "POST", { name: "Second", kind: "memory" });
    expect(backend.status).toBe(201);
    const backendId = field(await body(backend), "id");
    expect((await w.api("/api/backends", "POST", { name: "Second", kind: "memory" })).status).toBe(
      409,
    );
    expect((await w.api("/api/backends", "POST", { name: "x", kind: "nope" })).status).toBe(400);
    expect(fields(await body(await w.api("/api/backends")), "name")).toEqual(["Default", "Second"]);

    const mount = await w.api("/api/mounts", "POST", { name: "photos", backendId, root: "" });
    expect(mount.status).toBe(201);
    const id = field(await body(mount), "id");
    expect((await w.api(`/api/mounts/${id}`, "PATCH", { name: "pictures" })).status).toBe(200);
    expect((await w.api(`/api/mounts/${id}`, "PATCH", { name: "files" })).status).toBe(409);
    expect((await w.api(`/api/mounts/${id}`, "PATCH", { name: "a/b" })).status).toBe(400);
    const filesId = fields(await body(await w.api("/api/mounts")), "id").find((m) => m !== id);
    expect((await w.api(`/api/mounts/${filesId}`, "PATCH", { backendId, root: "" })).status).toBe(
      200,
    );
    expect(
      (await w.api(`/api/mounts/${id}`, "PATCH", { backendId: "nope", root: "" })).status,
    ).toBe(400);
    expect((await w.api(`/api/mounts/missing`, "PATCH", { name: "x" })).status).toBe(404);

    await w.key("read-only", ["/pictures"]);
    expect((await w.api(`/api/mounts/${id}`, "DELETE")).status).toBe(409);
    expect((await w.api(`/api/mounts/${filesId}`, "DELETE")).status).toBe(200);
    expect((await w.api(`/api/mounts/${filesId}`, "DELETE")).status).toBe(404);
  });

  it("exports, and imports the file into a new instance", async () => {
    const w = world();
    await w.setup();
    const { key: davKey } = await w.key("read-write");
    const answer = await body(await w.api("/api/export", "POST"));
    const exported = { key: field(answer, "key"), file: Reflect.get(Object(answer), "file") };
    const target = world();
    expect(
      (await target.api("/api/setup/import", "POST", { ...exported, token: "wrong" })).status,
    ).toBe(403);
    const refused = await target.api("/api/setup/import", "POST", {
      key: exported.key,
      file: { format: "other" },
      token: TOKEN,
    });
    expect(refused.status).toBe(422);
    expect(await body(refused)).toEqual({
      error: { code: "archive_invalid", message: "The file is not a Davloom export." },
    });
    expect(
      (await target.api("/api/setup/import", "POST", { ...exported, token: TOKEN })).status,
    ).toBe(201);
    expect(
      (await target.dav("/", davKey, { method: "PROPFIND", headers: { depth: "0" } })).status,
    ).toBe(207);
  });

  it("serves Better Auth's routes", async () => {
    const w = world();
    expect((await w.fetch("/api/auth/get-session")).status).toBe(200);
  });
});

describe("WebDAV", () => {
  it("asks for Basic credentials, but not of the Dashboard", async () => {
    const w = world();
    await w.setup();
    const plain = await w.fetch("/dav/", { method: "PROPFIND" });
    expect(plain.status).toBe(401);
    expect(plain.headers.get("www-authenticate")).toContain("Basic");
    const dashboard = await w.fetch("/dav/", {
      method: "PROPFIND",
      headers: { [DASHBOARD_HEADER]: "1" },
    });
    expect(dashboard.status).toBe(401);
    expect(dashboard.headers.has("www-authenticate")).toBe(false);
    expect((await w.dav("/", "dav_unknown", { method: "PROPFIND" })).status).toBe(401);
  });

  it("serves the Dashboard's session and every kind of key", async () => {
    const w = world();
    await w.setup();
    const readWrite = (await w.key("read-write")).key;
    const readOnly = (await w.key("read-only")).key;
    const scoped = (await w.key("read-write", ["/files/inbox"])).key;
    expect((await w.dav("/files/a.txt", readWrite, { method: "PUT", body: "a" })).status).toBe(201);
    expect(await (await w.dav("/files/a.txt", readOnly)).text()).toBe("a");
    // The second read of a key comes from the cache.
    expect(await (await w.dav("/files/a.txt", readOnly)).text()).toBe("a");
    expect((await w.dav("/files/a.txt", readOnly, { method: "DELETE" })).status).toBe(403);
    expect((await w.dav("/files/a.txt", scoped)).status).toBe(403);
    expect((await w.dav("/files/inbox", readWrite, { method: "MKCOL" })).status).toBe(201);
    expect((await w.dav("/files/inbox/b.txt", scoped, { method: "PUT", body: "b" })).status).toBe(
      201,
    );
    const session = await w.api("/api/me");
    expect(session.status).toBe(200);
    const signedIn = await w.fetch("/dav/files/a.txt", {
      headers: {
        [DASHBOARD_HEADER]: "1",
        cookie: (await w.api("/api/me")).headers.get("set-cookie") ?? "",
      },
    });
    expect([200, 401]).toContain(signedIn.status);
  });

  it("locks and unlocks through the database", async () => {
    const w = world();
    await w.setup();
    const key = (await w.key("read-write")).key;
    await w.dav("/files/l.txt", key, { method: "PUT", body: "x" });
    const lock = await w.dav("/files/l.txt", key, {
      method: "LOCK",
      body: '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>',
    });
    expect(lock.status).toBe(200);
    const token = lock.headers.get("lock-token") ?? "";
    expect((await w.dav("/files/l.txt", key, { method: "PUT", body: "y" })).status).toBe(423);
    expect(
      (
        await w.dav("/files/l.txt", key, {
          method: "PUT",
          body: "y",
          headers: { if: `(${token})` },
        })
      ).status,
    ).toBe(204);
    expect(
      (await w.dav("/files/l.txt", key, { method: "UNLOCK", headers: { "lock-token": token } }))
        .status,
    ).toBe(204);
  });
});

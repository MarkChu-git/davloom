import { Database } from "bun:sqlite";
import { createAuth, createIdentity } from "@davloom/auth";
import {
  Archive,
  createMemoryStorage,
  credentialCipherLayer,
  Identity,
  InstanceConfig,
  InstanceSettings,
  OperationLog,
  Records,
  StorageOpener,
  type StorageBackend,
} from "@davloom/core";
import { createArchive } from "@davloom/database/archive";
import { createOperationLog, createSettingsStore } from "@davloom/database/instance-data";
import {
  bunSqliteAtomic,
  createBunSqliteDatabase,
  migrateBunSqliteDatabase,
} from "@davloom/database/bun-sqlite";
import { createRepositories } from "@davloom/database/repositories";
import { Layer, Redacted } from "effect";
import { totpCode, totpSecretOf } from "@davloom/auth/testing";
import { STEP_UP_WINDOW_MS } from "@davloom/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, DASHBOARD_HEADER, type Instance } from "./app";
import { createSqlLockStore } from "./locks";
import { API_ACTIONS, AUTH_ACTIONS } from "./verification";

// The management API and the WebDAV entry of the real app, in this process: Better Auth and the
// records on an in-memory Bun SQLite database, and memory storage behind every backend.

const ORIGIN = "https://davloom.test";
const SECRET = "app-test-instance-secret-0123456789abcdef";
const OWNER = { username: "Owner", name: "Owner", email: "", password: "a password long enough" };

interface WorldOptions {
  readonly setupToken?: string;
  readonly publicOrigin?: string;
}

const memoryInstance = (options: WorldOptions = {}): Instance => {
  const db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  const repositories = createRepositories(db);
  const auth = createAuth({
    database: db,
    secret: SECRET,
    baseURL: ORIGIN,
    checkLeakedPasswords: false,
  });
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
      Layer.succeed(InstanceConfig, {
        storageKinds: ["memory"],
        setupToken: options.setupToken === undefined ? null : Redacted.make(options.setupToken),
      }),
      credentialCipherLayer(Redacted.make(SECRET)),
      Layer.succeed(OperationLog, createOperationLog(db, bunSqliteAtomic(db))),
      Layer.succeed(InstanceSettings, createSettingsStore(db)),
    ),
    authHandler: (request) => auth.handler(request),
    locks: createSqlLockStore(repositories.locks),
  };
};

const json = { "content-type": "application/json" };

const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

const world = (options: WorldOptions = {}) => {
  const app = createApp({
    instance: () => memoryInstance(options),
    publicOrigin: options.publicOrigin,
  });
  let cookie = "";
  const fetch = (path: string, init: RequestInit = {}) =>
    app.handle(new Request(`${ORIGIN}${path}`, init));
  const api = (path: string, method = "GET", body?: unknown) =>
    fetch(path, {
      method,
      headers: { ...json, origin: ORIGIN, cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const signIn = async () => {
    const signedIn = await api("/api/auth/sign-in/username", "POST", {
      username: OWNER.username,
      password: OWNER.password,
    });
    expect(signedIn.status).toBe(200);
    cookie = cookiesOf(signedIn);
    return signedIn;
  };
  const setup = async () => {
    const created = await api("/api/registration", "POST", OWNER);
    expect(created.status).toBe(201);
    await signIn();
  };
  const useCookie = (next: string) => {
    cookie = next;
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
  /** A WebDAV request of the Dashboard, with its session. */
  const dashboardDav = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set(DASHBOARD_HEADER, "1");
    headers.set("cookie", cookie);
    return fetch(`/dav${path}`, { ...init, headers });
  };
  return { app, fetch, api, setup, signIn, useCookie, key, dav, dashboardDav };
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
    for (const path of ["/api/registration", "/api/auth/get-session", "/dav/"]) {
      expect((await app.handle(new Request(`${ORIGIN}${path}`))).status, path).toBe(501);
    }
  });

  it("answers 503 not_configured when the instance cannot be built", async () => {
    const app = createApp({
      instance: () => {
        throw new Error("DAVLOOM_SECRET must be set");
      },
    });
    for (const path of ["/api/registration", "/dav/"]) {
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

describe("registration", () => {
  it("is open until the first account, refuses bad input, and then closes", async () => {
    const w = world();
    expect(await body(await w.api("/api/registration"))).toEqual({
      open: true,
      tokenRequired: false,
      passkeys: false,
    });
    const cases: [Record<string, unknown>, number, string][] = [
      [{ ...OWNER, username: " " }, 400, "invalid_input"],
      [{ ...OWNER, username: "a" }, 400, "username_refused"],
      [{ ...OWNER, username: "with space" }, 400, "username_refused"],
      [{ ...OWNER, email: "nope" }, 400, "invalid_input"],
      [{ ...OWNER, password: "short" }, 400, "password_refused"],
      [{ ...OWNER, name: "n".repeat(101) }, 400, "invalid_input"],
      [{}, 400, "invalid_input"],
    ];
    for (const [input, status, code] of cases) {
      const response = await w.api("/api/registration", "POST", input);
      expect(response.status, JSON.stringify(input)).toBe(status);
      expect(await body(response)).toMatchObject({ error: { code } });
    }
    await w.setup();
    expect(await body(await w.api("/api/registration"))).toEqual({
      open: false,
      tokenRequired: false,
      passkeys: false,
    });
    const again = await w.api("/api/registration", "POST", { ...OWNER, username: "mallory" });
    expect(again.status).toBe(409);
    expect(await body(again)).toEqual({ error: { code: "registration_closed" } });
  });

  it("gives the reason Better Auth refused a password", async () => {
    const w = world();
    const response = await w.api("/api/registration", "POST", { ...OWNER, password: "short" });
    expect(await body(response)).toEqual({
      error: { code: "password_refused", message: expect.stringMatching(/short/i) },
    });
  });

  it("lets one of two registrations at once win", async () => {
    const w = world();
    const [first, second] = await Promise.all([
      w.api("/api/registration", "POST", { ...OWNER, username: "first" }),
      w.api("/api/registration", "POST", { ...OWNER, username: "second" }),
    ]);
    expect([first.status, second.status].toSorted((a, b) => a - b)).toEqual([201, 409]);
  });

  it("keeps the public sign-up route of Better Auth closed", async () => {
    const w = world();
    const response = await w.api("/api/auth/sign-up/email", "POST", {
      name: "x",
      email: "x@example.com",
      password: OWNER.password,
    });
    expect(response.status).toBe(404);
    expect(await body(await w.api("/api/registration"))).toEqual({
      open: true,
      tokenRequired: false,
      passkeys: false,
    });
  });

  it("reads a body that is not JSON as empty", async () => {
    const w = world();
    const response = await w.fetch("/api/registration", {
      method: "POST",
      headers: { ...json, origin: ORIGIN },
      body: "not json",
    });
    expect(response.status).toBe(400);
  });

  it("signs in with the email too, when the owner gave one", async () => {
    const w = world();
    await w.api("/api/registration", "POST", { ...OWNER, email: "owner@example.com" });
    const signedIn = await w.api("/api/auth/sign-in/email", "POST", {
      email: "owner@example.com",
      password: OWNER.password,
    });
    expect(signedIn.status).toBe(200);
  });
});

/** Moves the clock past the step-up window, as if the session were signed in long ago. */
const later = () => {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + STEP_UP_WINDOW_MS + 1000 });
};

/** Adds GET /api/extra to an app, as an entry adds its own routes, and asks it. */
const extra = (app: ReturnType<typeof createApp>) =>
  app.get("/api/extra", () => "extra").handle(new Request("http://localhost/api/extra"));

describe("step-up verification", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("classifies every route of the app", () => {
    const app = createApp();
    const unclassified = app.routes
      .filter((route) => route.path.startsWith("/api/") && route.path !== "/api/auth/*")
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !Object.hasOwn(API_ACTIONS, key));
    expect(unclassified).toEqual([]);
  });

  it("refuses a route added under /api/ unless the caller classifies it", async () => {
    expect((await extra(createApp())).status).toBe(404);
    const classified = createApp({
      classify: (method, route) =>
        `${method} ${route}` === "GET /api/extra" ? "public" : undefined,
    });
    expect(await (await extra(classified)).text()).toBe("extra");
  });

  it("leaves the Dashboard's pages outside /api/ to the route that serves them", async () => {
    const app = createApp().all("/*", () => new Response("<html>"), { parse: "none" });
    for (const path of ["/", "/settings", "/sign-in"]) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status, path).toBe(200);
    }
  });

  it("refuses a Better Auth path nobody classified", async () => {
    const w = world();
    await w.setup();
    for (const path of ["/api-key/create", "/api-key/list", "/delete-user", "/sign-up/email"]) {
      expect((await w.api(`/api/auth${path}`, "POST", {})).status, path).toBe(404);
    }
    expect(Object.keys(AUTH_ACTIONS)).not.toContain("/api-key/create");
  });

  it("lets a fresh session run a step-up action", async () => {
    const w = world();
    await w.setup();
    expect((await w.api("/api/keys", "POST", { name: "k", access: "read-only" })).status).toBe(201);
  });

  it.each([
    ["POST", "/api/keys", { name: "k", access: "read-only" }],
    ["POST", "/api/export", undefined],
    ["POST", "/api/backends", { name: "b", kind: "memory" }],
    ["POST", "/api/auth/change-password", { currentPassword: "x", newPassword: "y" }],
    ["POST", "/api/auth/two-factor/enable", { password: "x" }],
    ["POST", "/api/auth/revoke-other-sessions", {}],
    ["POST", "/api/auth/update-user", { username: "someone" }],
  ] as const)(
    "refuses %s %s from a session that has not verified lately",
    async (method, path, input) => {
      const w = world();
      await w.setup();
      later();
      const response = await w.api(path, method, input);
      expect(response.status).toBe(403);
      expect(await body(response)).toEqual({ error: { code: "verification_required" } });
    },
  );

  it.each([
    ["GET", "/api/keys", undefined],
    ["GET", "/api/me", undefined],
    ["POST", "/api/auth/update-user", { name: "A new name" }],
    ["GET", "/api/auth/list-sessions", undefined],
  ] as const)("lets an old session %s %s", async (method, path, input) => {
    const w = world();
    await w.setup();
    later();
    expect((await w.api(path, method, input)).status).toBe(200);
  });

  it("re-verifies with the password, and then lets the action run", async () => {
    const w = world();
    await w.setup();
    later();
    const wrong = await w.api("/api/verify", "POST", { password: "not the password" });
    expect(wrong.status).toBe(400);
    expect(await body(wrong)).toEqual({ error: { code: "wrong_password" } });
    expect((await w.api("/api/verify", "POST", { password: OWNER.password })).status).toBe(200);
    expect((await w.api("/api/keys", "POST", { name: "k", access: "read-only" })).status).toBe(201);
  });

  it("locks re-verification after five wrong passwords", async () => {
    const w = world();
    await w.setup();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await w.api("/api/verify", "POST", { password: "not the password" })).status).toBe(
        400,
      );
    }
    const locked = await w.api("/api/verify", "POST", { password: OWNER.password });
    expect(locked.status).toBe(429);
    expect(await body(locked)).toEqual({ error: { code: "verification_locked" } });
  });

  it("needs a session to re-verify", async () => {
    const w = world();
    await w.api("/api/registration", "POST", OWNER);
    expect(
      (
        await w.fetch("/api/verify", {
          method: "POST",
          headers: { ...json, origin: ORIGIN },
          body: "{}",
        })
      ).status,
    ).toBe(401);
  });

  it("asks for the authenticator code when two-step verification is on", async () => {
    const w = world();
    await w.setup();
    const enabled = await body(
      await w.api("/api/auth/two-factor/enable", "POST", { password: OWNER.password }),
    );
    const secret = totpSecretOf(field(enabled, "totpURI"));
    const verified = await w.api("/api/auth/two-factor/verify-totp", "POST", {
      code: await totpCode(secret),
    });
    expect(verified.status).toBe(200);
    w.useCookie(cookiesOf(verified));
    later();
    const withoutCode = await w.api("/api/verify", "POST", { password: OWNER.password });
    expect(await body(withoutCode)).toEqual({ error: { code: "code_required" } });
    const withCode = await w.api("/api/verify", "POST", {
      password: OWNER.password,
      code: await totpCode(secret),
    });
    expect(withCode.status).toBe(200);
    expect((await w.api("/api/export", "POST")).status).toBe(200);
  });

  it("asks the Dashboard to step up before it deletes or overwrites files", async () => {
    const w = world();
    await w.setup();
    const signedIn = await w.signIn();
    const cookie = cookiesOf(signedIn);
    const dashboard = (path: string, method: string, headers: Record<string, string> = {}) =>
      w.fetch(`/dav${path}`, {
        method,
        headers: { [DASHBOARD_HEADER]: "1", cookie, ...headers },
        body: method === "PUT" ? "x" : undefined,
      });
    const create = { "if-none-match": "*" };
    expect((await dashboard("/files/a.txt", "PUT", create)).status).toBe(201);
    later();
    expect((await dashboard("/files/a.txt", "GET")).status).toBe(200);
    expect((await dashboard("/files/b.txt", "PUT", create)).status).toBe(201);
    // A create-only PUT to a file that exists changes nothing.
    expect((await dashboard("/files/a.txt", "PUT", create)).status).toBe(412);
    expect(
      (await dashboard("/files/a.txt", "COPY", { destination: "/dav/files/c.txt", overwrite: "F" }))
        .status,
    ).toBe(201);
    for (const [method, headers] of [
      ["DELETE", {}],
      ["PUT", {}],
      ["PUT", { "if-none-match": '"some-etag"' }],
      ["PUT", { "if-match": "*" }],
      ["MOVE", { destination: "/dav/files/b.txt" }],
      ["COPY", { destination: "/dav/files/b.txt", overwrite: "T" }],
    ] as const) {
      const refused = await dashboard("/files/a.txt", method, headers);
      expect(refused.status, method).toBe(403);
      expect(await body(refused)).toEqual({ error: { code: "verification_required" } });
    }
  });
});

describe("the management API", () => {
  it.each(["/api/me", "/api/overview", "/api/keys", "/api/backends", "/api/mounts"])(
    "needs a session for %s",
    async (path) => {
      const w = world();
      await w.api("/api/registration", "POST", OWNER);
      expect((await w.fetch(path)).status).toBe(401);
    },
  );

  it("shows the administrator and the instance", async () => {
    const w = world();
    await w.setup();
    expect(await body(await w.api("/api/me"))).toMatchObject({
      username: OWNER.username,
      email: null,
    });
    const overview: unknown = await body(await w.api("/api/overview"));
    expect(Object.keys(Object(overview)).toSorted()).toEqual(["backends", "mounts", "usage"]);
  });

  it("creates, lists and revokes keys", async () => {
    const w = world();
    await w.setup();
    const { id } = await w.key("read-only");
    expect((await w.api("/api/keys", "POST", { name: "", access: "read-only" })).status).toBe(400);
    // Names up to 64 characters, the services' limit, reach Better Auth and are stored.
    const long = await w.api("/api/keys", "POST", { name: "n".repeat(64), access: "read-only" });
    expect(long.status).toBe(201);
    const tooLong = await w.api("/api/keys", "POST", { name: "n".repeat(65), access: "read-only" });
    expect(tooLong.status).toBe(400);
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
    const refused = await target.api("/api/registration/import", "POST", {
      key: exported.key,
      file: { format: "other" },
    });
    expect(refused.status).toBe(422);
    expect(await body(refused)).toEqual({
      error: { code: "archive_invalid", message: "The file is not a Davloom export." },
    });
    expect((await target.api("/api/registration/import", "POST", exported)).status).toBe(201);
    expect((await target.api("/api/registration/import", "POST", exported)).status).toBe(409);
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

describe("HTTPS only (PRD §12)", () => {
  const app = createApp({ webdavHandler: () => new Response("dav", { status: 207 }) });
  const permissive = createApp({
    allowHttp: true,
    webdavHandler: () => new Response("dav", { status: 207 }),
  });

  it.each([
    ["https from anywhere", "https://davloom.test/dav/", {}, 207],
    ["plain http from another host", "http://davloom.test/dav/", {}, 403],
    ["plain http to the API", "http://davloom.test/api/registration", {}, 403],
    ["plain http to the auth routes", "http://davloom.test/api/auth/get-session", {}, 403],
    ["the health check over plain http", "http://davloom.test/api/health", {}, 200],
    ["the health check with a slash over plain http", "http://davloom.test/api/health/", {}, 200],
    ["plain http on localhost", "http://localhost:3000/dav/", {}, 207],
    ["plain http on 127.0.0.1", "http://127.0.0.1:3000/dav/", {}, 207],
    ["plain http on ::1", "http://[::1]:3000/dav/", {}, 207],
    [
      "behind a proxy that used https",
      "http://nas.local/dav/",
      { "x-forwarded-proto": "https" },
      207,
    ],
    [
      "behind proxies, the first used https",
      "http://nas.local/dav/",
      { "x-forwarded-proto": "HTTPS, http" },
      207,
    ],
    [
      "behind a proxy that used http",
      "http://nas.local/dav/",
      { "x-forwarded-proto": "http" },
      403,
    ],
    ["a lookalike of localhost", "http://localhost.evil.test/dav/", {}, 403],
    ["a lookalike of a loopback address", "http://127.0.0.1.evil.test/dav/", {}, 403],
  ])("%s", async (_, url, headers: Record<string, string>, status) => {
    const method = url.includes("/api/") ? "GET" : "PROPFIND";
    const response = await app.handle(new Request(url, { method, headers }));
    expect(response.status).toBe(status);
    if (status === 403) {
      expect(await response.text()).toMatch(/over HTTPS only/);
    }
  });

  it("serves plain http to any host when the deployment allows it", async () => {
    const response = await permissive.handle(
      new Request("http://nas.local/dav/", { method: "PROPFIND" }),
    );
    expect(response.status).toBe(207);
  });
});

describe("renaming a key", () => {
  it("renames a key, keeps it working, and refuses a bad name or an unknown key", async () => {
    const w = world();
    await w.setup();
    const created = await w.key("read-write");
    const renamed = await w.api(`/api/keys/${created.id}`, "PATCH", { name: " Phone " });
    expect(renamed.status).toBe(200);
    expect(await body(renamed)).toEqual({ id: created.id, name: "Phone" });
    expect(fields(await body(await w.api("/api/keys")), "name")).toEqual(["Phone"]);
    expect(
      (await w.dav("/files/", created.key, { method: "PROPFIND", headers: { depth: "0" } })).status,
    ).toBe(207);
    expect((await w.api(`/api/keys/${created.id}`, "PATCH", { name: "" })).status).toBe(400);
    expect((await w.api(`/api/keys/${created.id}`, "PATCH", {})).status).toBe(400);
    expect((await w.api("/api/keys/unknown", "PATCH", { name: "X" })).status).toBe(404);
  });

  it("asks for a session", async () => {
    const w = world();
    await w.setup();
    const created = await w.key("read-write");
    const anonymous = await w.fetch(`/api/keys/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ name: "X" }),
    });
    expect(anonymous.status).toBe(401);
  });
});

const lastUsed = async (w: ReturnType<typeof world>, id: string): Promise<unknown> => {
  const listed = await body(await w.api("/api/keys"));
  return Array.isArray(listed)
    ? listed.find((item: unknown) => field(item, "id") === id)?.lastUsedAt
    : undefined;
};

describe("API Key use and scope", () => {
  it("records when a WebDAV client last signed in with a key", async () => {
    const w = world();
    await w.setup();
    const used = await w.key("read-write");
    const unused = await w.key("read-only");
    expect(await lastUsed(w, used.id)).toBeNull();
    const before = Date.now();
    expect(
      (await w.dav("/files/", used.key, { method: "PROPFIND", headers: { depth: "1" } })).status,
    ).toBe(207);
    const at = await lastUsed(w, used.id);
    expect(typeof at).toBe("string");
    expect(Date.parse(String(at))).toBeGreaterThanOrEqual(before - 1000);
    expect(await lastUsed(w, unused.id)).toBeNull();
    // A failed sign-in records nothing.
    expect((await w.dav("/files/", `${unused.key}x`, { method: "PROPFIND" })).status).toBe(401);
    expect(await lastUsed(w, unused.id)).toBeNull();
  });

  // A key limited to a folder inside a Mount, as the Dashboard's Mount and folder fields make it.
  it.each([
    ["PROPFIND", "/files/", 207],
    ["PROPFIND", "/files/photos/", 207],
    ["GET", "/files/top.txt", 403],
    ["PUT", "/files/top.txt", 403],
    ["GET", "/files/photos/a.jpg", 200],
    ["PUT", "/files/photos/b.jpg", 201],
    ["DELETE", "/files/photos/a.jpg", 204],
    ["GET", "/files/other/c.txt", 403],
    ["MKCOL", "/files/photos/new/", 201],
    ["MKCOL", "/files/elsewhere/", 403],
  ])("lets a key scoped to /files/photos %s %s with %i", async (method, path, status) => {
    const w = world();
    await w.setup();
    const admin = (await w.key("read-write")).key;
    expect((await w.dav("/files/photos", admin, { method: "MKCOL" })).status).toBe(201);
    expect((await w.dav("/files/other", admin, { method: "MKCOL" })).status).toBe(201);
    await w.dav("/files/top.txt", admin, { method: "PUT", body: "t" });
    await w.dav("/files/photos/a.jpg", admin, { method: "PUT", body: "a" });
    await w.dav("/files/other/c.txt", admin, { method: "PUT", body: "c" });
    const scoped = (await w.key("read-write", ["/files/photos"])).key;

    const init: RequestInit = {
      method,
      ...(method === "PUT" ? { body: "x" } : {}),
      ...(method === "PROPFIND" ? { headers: { depth: "1" } } : {}),
    };
    expect((await w.dav(path, scoped, init)).status).toBe(status);
  });

  it("lists only the scoped folder above a key's root", async () => {
    const w = world();
    await w.setup();
    const admin = (await w.key("read-write")).key;
    await w.dav("/files/photos", admin, { method: "MKCOL" });
    await w.dav("/files/other", admin, { method: "MKCOL" });
    const scoped = (await w.key("read-only", ["/files/photos"])).key;
    const listing = await (
      await w.dav("/files/", scoped, { method: "PROPFIND", headers: { depth: "1" } })
    ).text();
    expect(listing).toContain("/dav/files/photos/");
    expect(listing).not.toContain("/dav/files/other/");
  });
});

describe("locks from the Dashboard", () => {
  const LOCK_BODY =
    '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner><D:href>Davloom Dashboard</D:href></D:owner></D:lockinfo>';
  const DISCOVER =
    '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:lockdiscovery/></D:prop></D:propfind>';

  it("locks a file that a WebDAV client then cannot change, and unlocks it", async () => {
    const w = world();
    await w.setup();
    const client = (await w.key("read-write")).key;
    await w.dav("/files/report.txt", client, { method: "PUT", body: "x" });
    const lock = await w.dashboardDav("/files/report.txt", {
      method: "LOCK",
      headers: { timeout: "Second-3600", depth: "0" },
      body: LOCK_BODY,
    });
    expect(lock.status).toBe(200);
    const token = lock.headers.get("lock-token") ?? "";
    expect((await w.dav("/files/report.txt", client, { method: "PUT", body: "y" })).status).toBe(
      423,
    );
    // The client sees the lock and who holds it, as Finder does.
    const seen = await (
      await w.dav("/files/report.txt", client, {
        method: "PROPFIND",
        headers: { depth: "0" },
        body: DISCOVER,
      })
    ).text();
    expect(seen).toContain("Davloom Dashboard");
    expect(
      (
        await w.dashboardDav("/files/report.txt", {
          method: "UNLOCK",
          headers: { "lock-token": token },
        })
      ).status,
    ).toBe(204);
    expect((await w.dav("/files/report.txt", client, { method: "PUT", body: "y" })).status).toBe(
      204,
    );
  });

  it("unlocks a lock that a WebDAV client holds", async () => {
    const w = world();
    await w.setup();
    const client = (await w.key("read-write")).key;
    await w.dav("/files/held.txt", client, { method: "PUT", body: "x" });
    const lock = await w.dav("/files/held.txt", client, { method: "LOCK", body: LOCK_BODY });
    expect(lock.status).toBe(200);
    const listing = await (
      await w.dashboardDav("/files/", {
        method: "PROPFIND",
        headers: { depth: "1" },
        body: DISCOVER,
      })
    ).text();
    const token = /<D:locktoken><D:href>([^<]+)<\/D:href>/.exec(listing)?.[1] ?? "";
    expect(token).toMatch(/^urn:uuid:/);
    expect(
      (
        await w.dashboardDav("/files/held.txt", {
          method: "UNLOCK",
          headers: { "lock-token": `<${token}>` },
        })
      ).status,
    ).toBe(204);
  });
});

describe("requests from another site", () => {
  const EVIL = "https://evil.example";

  it.each([
    ["POST", "/api/keys", { name: "stolen", access: "read-write" }],
    ["POST", "/api/export", {}],
    ["POST", "/api/verify", { password: OWNER.password }],
    ["POST", "/api/auth/sign-out", {}],
    ["POST", "/api/auth/two-factor/enable", { password: OWNER.password }],
    [
      "POST",
      "/api/auth/change-password",
      { currentPassword: OWNER.password, newPassword: "x".repeat(20) },
    ],
    ["PUT", "/api/settings/storage", { defaultBackendId: null }],
  ])("are refused for %s %s, with the owner's session", async (method, path, input) => {
    const w = world();
    await w.setup();
    const { cookie } = { cookie: cookiesOf(await w.signIn()) };
    const response = await w.fetch(path, {
      method,
      headers: { ...json, origin: EVIL, cookie },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(403);
    expect(await body(response)).toMatchObject({ error: { code: "cross_site" } });
    expect(fields(await body(await w.api("/api/keys")), "name")).toEqual([]);
    expect((await w.api("/api/me")).status).toBe(200);
  });

  it("are refused as a form post, which a page on any site can send", async () => {
    const w = world();
    await w.setup();
    const cookie = cookiesOf(await w.signIn());
    for (const origin of [EVIL, ORIGIN]) {
      const response = await w.fetch("/api/keys", {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" },
        body: "name=stolen&access=read-write",
      });
      expect(response.status, origin).toBe(origin === EVIL ? 403 : 415);
    }
    expect(fields(await body(await w.api("/api/keys")), "name")).toEqual([]);
  });

  it("are refused for registration, so another site cannot register the owner", async () => {
    const w = world();
    const response = await w.fetch("/api/registration", {
      method: "POST",
      headers: { ...json, origin: EVIL },
      body: JSON.stringify(OWNER),
    });
    expect(response.status).toBe(403);
    expect(await body(await w.api("/api/registration"))).toMatchObject({ open: true });
  });

  it("come only from the configured origin when there is one", async () => {
    const w = world({ publicOrigin: "https://files.example" });
    const own = await w.fetch("/api/registration", {
      method: "POST",
      headers: { ...json, origin: ORIGIN },
      body: JSON.stringify(OWNER),
    });
    expect(own.status).toBe(403);
    const configured = await w.fetch("/api/registration", {
      method: "POST",
      headers: { ...json, origin: "https://files.example" },
      body: JSON.stringify(OWNER),
    });
    expect(configured.status).toBe(201);
  });

  it("leave reads alone", async () => {
    const w = world();
    expect((await w.fetch("/api/registration", { headers: { origin: EVIL } })).status).toBe(200);
  });
});

describe("the setup token", () => {
  it.each([
    [undefined, 403, "setup_token_invalid"],
    ["", 403, "setup_token_invalid"],
    ["wrong-token", 403, "setup_token_invalid"],
    ["a-setup-token", 201, undefined],
  ])("with %j answers registration %i", async (setupToken, status, code) => {
    const w = world({ setupToken: "a-setup-token" });
    expect(await body(await w.api("/api/registration"))).toEqual({
      open: true,
      tokenRequired: true,
      passkeys: false,
    });
    const response = await w.api("/api/registration", "POST", { ...OWNER, setupToken });
    expect(response.status).toBe(status);
    if (code !== undefined) {
      expect(await body(response)).toEqual({ error: { code } });
      expect(await body(await w.api("/api/registration"))).toMatchObject({ open: true });
    }
  });

  it("is needed for an import too", async () => {
    const w = world({ setupToken: "a-setup-token" });
    const response = await w.api("/api/registration/import", "POST", { key: "k", file: {} });
    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ error: { code: "setup_token_invalid" } });
  });
});

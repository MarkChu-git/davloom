import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, registerOwner, SECRET, stringField } from "./davloom";
import { startBunServer, startWorkerdServer, type Server } from "./servers";

// The guards of the account on the production builds, with the variables a deployment sets and
// no more: Better Auth's rate limit is on without being asked for, a request from another site
// changes nothing, and passkeys stay off without DAVLOOM_URL.

const OFFLINE = { DAVLOOM_CHECK_LEAKED_PASSWORDS: "off" } as const;

const DEPLOYMENTS: readonly [string, () => Promise<Server>][] = [
  [
    "Workers with D1 and Durable Objects",
    () =>
      startWorkerdServer("apps/api/wrangler.jsonc", {
        vars: { DAVLOOM_SECRET: SECRET, ...OFFLINE },
      }),
  ],
  [
    "Bun with SQLite",
    async () => {
      const dataDir = mkdtempSync(join(tmpdir(), "davloom-guards-"));
      const server = await startBunServer("apps/api/src/entry.bun.ts", {
        DAVLOOM_SECRET: SECRET,
        ...OFFLINE,
        DAVLOOM_DATA_DIR: dataDir,
      });
      return {
        ...server,
        stop: async () => {
          await server.stop();
          rmSync(dataDir, { recursive: true, force: true });
        },
      };
    },
  ],
];

const EVIL = "https://evil.example";

describe.each(DEPLOYMENTS)("the account's guards on %s", (_name, start) => {
  let server: Server;
  let cookie: string;

  beforeAll(async () => {
    server = await start();
    cookie = await registerOwner(server);
  }, 120_000);
  afterAll(() => server?.stop());

  it("refuses a change another site sends with the owner's session", async () => {
    for (const [path, body] of [
      ["/api/keys", { name: "stolen", access: "read-write" }],
      ["/api/auth/sign-out", {}],
      ["/api/auth/two-factor/enable", { password: ADMIN.password }],
    ] as const) {
      const response = await server.fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", origin: EVIL, cookie },
        body: JSON.stringify(body),
      });
      expect(response.status, path).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "cross_site" } });
    }
    const form = await server.fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: server.url, cookie },
      body: JSON.stringify({ name: "stolen", access: "read-write" }),
    });
    expect(form.status).toBe(415);
    const keys = await server.fetch("/api/keys", { headers: { cookie } });
    expect(keys.status).toBe(200);
    expect(await keys.json()).toEqual([]);
  });

  it("says passkeys are off, and answers no passkey route, without DAVLOOM_URL", async () => {
    const status: unknown = await (await server.fetch("/api/registration")).json();
    expect(status).toMatchObject({ passkeys: false, tokenRequired: false });
    const options = await server.fetch("/api/auth/passkey/generate-authenticate-options", {
      headers: { cookie },
    });
    expect(options.status).toBe(404);
  });

  it("limits sign-in attempts without being asked to", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await server.fetch("/api/auth/sign-in/username", {
        method: "POST",
        body: JSON.stringify({ username: ADMIN.username, password: `wrong password ${attempt}` }),
      });
      await response.arrayBuffer();
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(10);
  });

  it("still knows the owner's session after the limit", async () => {
    const me = await server.fetch("/api/me", { headers: { cookie } });
    expect(stringField(await me.json(), "username")).toBe(ADMIN.username);
  });
});

describe("sign-in behind a trusted reverse proxy on Bun", () => {
  let server: Server;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "davloom-proxy-"));
    // The tests reach the server from 127.0.0.1, as a proxy on the same machine would.
    server = await startBunServer("apps/api/src/entry.bun.ts", {
      DAVLOOM_SECRET: SECRET,
      ...OFFLINE,
      DAVLOOM_DATA_DIR: dataDir,
      DAVLOOM_TRUSTED_PROXIES: "127.0.0.1, ::1",
    });
    await registerOwner(server);
  }, 120_000);
  afterAll(async () => {
    await server?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const signIn = async (client: string, password: string) => {
    const response = await server.fetch("/api/auth/sign-in/username", {
      method: "POST",
      headers: { "x-forwarded-for": client },
      body: JSON.stringify({ username: ADMIN.username, password }),
    });
    await response.arrayBuffer();
    return response.status;
  };

  it("limits the client that floods it, and lets the owner in from another address", async () => {
    const flood: number[] = [];
    for (let attempt = 0; attempt < 14; attempt += 1) {
      flood.push(await signIn("198.51.100.66", `wrong password ${attempt}`));
    }
    expect(flood).toContain(429);
    expect(await signIn("198.51.100.7", ADMIN.password)).toBe(200);
  });

  it("counts a client that forges X-Forwarded-For by the address the proxy saw", async () => {
    const flood: number[] = [];
    for (let attempt = 0; attempt < 14; attempt += 1) {
      flood.push(await signIn(`10.9.9.${attempt}, 198.51.100.99`, `wrong password ${attempt}`));
    }
    expect(flood).toContain(429);
  });
});

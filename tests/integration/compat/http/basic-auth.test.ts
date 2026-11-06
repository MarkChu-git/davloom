import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeRuntimes, type Server } from "./servers";

const ADMIN = { email: "admin@davloom.test", password: "correct horse battery staple" };
const PROTECTED_PATH = "/api/__probe/auth/dav/a.txt";

const basic = (username: string, password: string) => ({
  authorization: `Basic ${btoa(`${username}:${password}`)}`,
});

describe.each(probeRuntimes)("Basic Auth with an API key on $name", ({ start }) => {
  let server: Server;

  const createKey = async (): Promise<{ id: string; key: string }> => {
    const response = await server.fetch("/api/__probe/auth/api-keys", { method: "POST" });
    return (await response.json()) as { id: string; key: string };
  };

  beforeAll(async () => {
    server = await start();
    await server.fetch("/api/__probe/auth/setup", { method: "POST" });
  });
  afterAll(() => server?.stop());

  it("a valid key passes on a WebDAV method", async () => {
    const { key } = await createKey();
    const response = await server.fetch(PROTECTED_PATH, {
      method: "PROPFIND",
      headers: basic("client", key),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true, username: "client" });
  });

  it("an unknown key returns 401 and asks for Basic credentials", async () => {
    const response = await server.fetch(PROTECTED_PATH, {
      method: "PROPFIND",
      headers: basic("client", "not-a-real-key"),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it("no credentials return 401", async () => {
    const response = await server.fetch(PROTECTED_PATH, { method: "PROPFIND" });

    expect(response.status).toBe(401);
  });

  it("a revoked key returns 401", async () => {
    const { id, key } = await createKey();
    const before = await server.fetch(PROTECTED_PATH, { headers: basic("client", key) });

    const login = await server.fetch("/api/__probe/auth/login", {
      method: "POST",
      body: JSON.stringify(ADMIN),
      headers: { "content-type": "application/json" },
    });
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const revoke = await server.fetch(`/api/__probe/auth/api-keys/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    const after = await server.fetch(PROTECTED_PATH, { headers: basic("client", key) });

    expect(before.status).toBe(200);
    expect(login.status).toBe(200);
    expect(revoke.status).toBe(200);
    expect(after.status).toBe(401);
  });

  it("the administrator password does not work as a WebDAV credential", async () => {
    const response = await server.fetch(PROTECTED_PATH, {
      headers: basic(ADMIN.email, ADMIN.password),
    });

    expect(response.status).toBe(401);
  });
});

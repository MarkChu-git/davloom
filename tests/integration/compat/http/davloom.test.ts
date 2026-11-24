import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, basic, startDavloom, stringField, type Davloom } from "./davloom";

let davloom: Davloom;

beforeAll(async () => {
  davloom = await startDavloom();
});
afterAll(() => davloom?.server.stop());

describe("registration and sign-in", () => {
  it("registration closes once the owner exists", async () => {
    const status = await davloom.server.fetch("/api/registration");
    expect(await status.json()).toEqual({ open: false });
    const again = await davloom.server.fetch("/api/registration", {
      method: "POST",
      body: JSON.stringify({ ...ADMIN, username: "mallory", email: "other@example.com" }),
    });
    expect(again.status).toBe(409);
  });

  it("signs in with the email as well as the username", async () => {
    const response = await davloom.server.fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: davloom.server.url },
      body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
    });
    expect(response.ok).toBe(true);
  });

  it("refuses Better Auth paths Davloom does not classify", async () => {
    for (const path of ["/api/auth/api-key/create", "/api/auth/api-key/list"]) {
      const response = await davloom.api(path, { method: "POST", body: "{}" });
      expect(response.status, path).toBe(404);
    }
  });

  it("the management API needs a session", async () => {
    for (const path of ["/api/me", "/api/keys", "/api/mounts", "/api/backends", "/api/overview"]) {
      expect((await davloom.server.fetch(path)).status).toBe(401);
    }
    const me = await davloom.api("/api/me");
    expect(me.status).toBe(200);
    const owner: unknown = await me.json();
    expect(stringField(owner, "email")).toBe(ADMIN.email);
    expect(stringField(owner, "username")).toBe(ADMIN.username);
  });

  it("a wrong password does not sign in", async () => {
    const response = await davloom.server.fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: davloom.server.url },
      body: JSON.stringify({ email: ADMIN.email, password: "wrong password here" }),
    });
    expect(response.ok).toBe(false);
  });

  it("public sign-up is closed", async () => {
    const response = await davloom.server.fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: davloom.server.url },
      body: JSON.stringify({
        name: "x",
        email: "x@example.com",
        password: "another long password",
      }),
    });
    expect(response.ok).toBe(false);
  });

  it("registration created the default Mount on a Durable Objects backend", async () => {
    expect(await (await davloom.api("/api/mounts")).json()).toEqual([
      expect.objectContaining({ name: "files", backendKind: "durable-object" }),
    ]);
  });
});

describe("WebDAV credentials", () => {
  it("asks for Basic credentials without them", async () => {
    const response = await davloom.server.fetch("/dav/", { method: "PROPFIND" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it.each(["dav_wrong-key-that-does-not-exist", "short", ""])("refuses the key %j", async (key) => {
    const response = await davloom.server.fetch("/dav/", {
      method: "PROPFIND",
      headers: { authorization: basic(key), depth: "0" },
    });
    expect(response.status).toBe(401);
  });

  it("refuses the administrator's password over WebDAV", async () => {
    const response = await davloom.server.fetch("/dav/", {
      method: "PROPFIND",
      headers: { authorization: `Basic ${btoa(`${ADMIN.email}:${ADMIN.password}`)}`, depth: "0" },
    });
    expect(response.status).toBe(401);
  });

  it("a Read Only key reads but never writes", async () => {
    const { dav, readOnlyKey } = davloom;
    expect((await dav("/files/ro.txt", { method: "PUT", body: "x" })).status).toBe(201);
    expect((await dav("/files/ro.txt", { key: readOnlyKey })).status).toBe(200);
    for (const method of ["PUT", "DELETE", "MKCOL", "PROPPATCH", "LOCK", "MOVE", "COPY"]) {
      const response = await dav("/files/ro.txt", {
        key: readOnlyKey,
        method,
        headers: { destination: `${davloom.server.url}/dav/files/ro2.txt` },
      });
      expect(response.status, method).toBe(403);
    }
  });

  it("a revoked key stops working once the cache expires, and at once in this isolate", async () => {
    const created = await davloom.api("/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "tmp", access: "read-only" }),
    });
    const body: unknown = await created.json();
    const id = stringField(body, "id");
    const key = stringField(body, "key");
    expect(
      (await davloom.dav("/", { key, method: "PROPFIND", headers: { depth: "0" } })).status,
    ).toBe(207);
    expect((await davloom.api(`/api/keys/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(
      (await davloom.dav("/", { key, method: "PROPFIND", headers: { depth: "0" } })).status,
    ).toBe(401);
  });

  it("the Dashboard reaches WebDAV with its session and the marker header only", async () => {
    const plain = await davloom.server.fetch("/dav/", {
      method: "PROPFIND",
      headers: { cookie: davloom.cookie, depth: "0" },
    });
    expect(plain.status).toBe(401);
    expect(plain.headers.get("www-authenticate")).toContain("Basic");
    const expired = await davloom.server.fetch("/dav/", {
      method: "PROPFIND",
      headers: { depth: "0", "x-davloom-dashboard": "1" },
    });
    // No Basic challenge for the Dashboard, so the browser opens no login dialog of its own.
    expect(expired.status).toBe(401);
    expect(expired.headers.has("www-authenticate")).toBe(false);
    const marked = await davloom.server.fetch("/dav/", {
      method: "PROPFIND",
      headers: { cookie: davloom.cookie, depth: "0", "x-davloom-dashboard": "1" },
    });
    expect(marked.status).toBe(207);
  });
});

describe("WebDAV on Durable Objects", () => {
  it("advertises Class 1 and 2", async () => {
    const response = await davloom.dav("/", { method: "OPTIONS" });
    expect(response.headers.get("dav")).toBe("1, 2");
  });

  it("lists the Mounts at the root", async () => {
    const xml = await (
      await davloom.dav("/", { method: "PROPFIND", headers: { depth: "1" } })
    ).text();
    expect(xml).toContain("<D:href>/dav/files/</D:href>");
  });

  it("refuses to create or delete at the root", async () => {
    expect((await davloom.dav("/new", { method: "MKCOL" })).status).toBe(403);
    expect((await davloom.dav("/files", { method: "DELETE" })).status).toBe(403);
    expect((await davloom.dav("/x.txt", { method: "PUT", body: "x" })).status).toBe(403);
  });

  it("round-trips a 5 MiB file in chunks, with ranges across chunk borders", async () => {
    const bytes = new Uint8Array(5 * 1024 * 1024 + 123);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7 + (i >> 13)) % 251;
    const put = await davloom.dav("/files/big.bin", { method: "PUT", body: bytes });
    expect(put.status).toBe(201);
    const got = new Uint8Array(await (await davloom.dav("/files/big.bin")).arrayBuffer());
    expect(got.length).toBe(bytes.length);
    expect(got.every((value, index) => value === bytes[index])).toBe(true);
    const start = 1024 * 1024 - 10;
    const range = await davloom.dav("/files/big.bin", {
      headers: { range: `bytes=${start}-${start + 2 * 1024 * 1024}` },
    });
    expect(range.status).toBe(206);
    const slice = new Uint8Array(await range.arrayBuffer());
    expect(slice.length).toBe(2 * 1024 * 1024 + 1);
    expect(slice.every((value, index) => value === bytes[start + index])).toBe(true);
  });

  it("creates, moves, copies and deletes a tree", async () => {
    const { dav, server } = davloom;
    const destination = (path: string) => ({ destination: `${server.url}/dav/files${path}` });
    expect((await dav("/files/t", { method: "MKCOL" })).status).toBe(201);
    expect((await dav("/files/t/sub", { method: "MKCOL" })).status).toBe(201);
    expect((await dav("/files/t/sub/a.txt", { method: "PUT", body: "alpha" })).status).toBe(201);
    expect((await dav("/files/t", { method: "COPY", headers: destination("/t2") })).status).toBe(
      201,
    );
    expect((await dav("/files/t", { method: "MOVE", headers: destination("/t3") })).status).toBe(
      201,
    );
    expect(await (await dav("/files/t2/sub/a.txt")).text()).toBe("alpha");
    expect(await (await dav("/files/t3/sub/a.txt")).text()).toBe("alpha");
    expect((await dav("/files/t/sub/a.txt")).status).toBe(404);
    expect((await dav("/files/t3", { method: "DELETE" })).status).toBe(204);
    expect((await dav("/files/t3/sub/a.txt")).status).toBe(404);
  });

  it("locks and unlocks through D1", async () => {
    const { dav } = davloom;
    await dav("/files/locked.txt", { method: "PUT", body: "x" });
    const lock = await dav("/files/locked.txt", {
      method: "LOCK",
      body: '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>',
    });
    expect(lock.status).toBe(200);
    const token = lock.headers.get("lock-token") ?? "";
    expect((await dav("/files/locked.txt", { method: "PUT", body: "y" })).status).toBe(423);
    expect(
      (await dav("/files/locked.txt", { method: "PUT", body: "y", headers: { if: `(${token})` } }))
        .status,
    ).toBe(204);
    expect(
      (await dav("/files/locked.txt", { method: "UNLOCK", headers: { "lock-token": token } }))
        .status,
    ).toBe(204);
    expect((await dav("/files/locked.txt", { method: "PUT", body: "z" })).status).toBe(204);
  });

  it("keeps dead properties", async () => {
    const { dav } = davloom;
    await dav("/files/p.txt", { method: "PUT", body: "x" });
    const patch = await dav("/files/p.txt", {
      method: "PROPPATCH",
      body: '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><z:tag xmlns:z="urn:z">v</z:tag></D:prop></D:set></D:propertyupdate>',
    });
    expect(patch.status).toBe(207);
    const xml = await (
      await dav("/files/p.txt", { method: "PROPFIND", headers: { depth: "0" } })
    ).text();
    expect(xml).toContain('<tag xmlns="urn:z">v</tag>');
  });

  it("reports usage in the overview", async () => {
    expect(await (await davloom.api("/api/overview")).json()).toMatchObject({
      usage: {
        files: expect.any(Number),
        bytes: expect.toSatisfy((bytes: number) => bytes > 5 * 1024 * 1024),
      },
    });
  });
});

const scopedKey = async (paths: string[], access = "read-write") => {
  const response = await davloom.api("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name: `scoped ${paths.join(" ")}`, access, paths }),
  });
  expect(response.status).toBe(201);
  return stringField(await response.json(), "key");
};

describe("keys limited to a folder", () => {
  it("reaches its folder, browses the way to it, and nothing else", async () => {
    const { dav, server } = davloom;
    await dav("/files/scope", { method: "MKCOL" });
    await dav("/files/scope/in", { method: "MKCOL" });
    await dav("/files/scope/out", { method: "MKCOL" });
    await dav("/files/scope/in/a.txt", { method: "PUT", body: "inside" });
    await dav("/files/scope/out/b.txt", { method: "PUT", body: "outside" });
    const key = await scopedKey(["/files/scope/in"]);

    const root = await (
      await dav("/", { key, method: "PROPFIND", headers: { depth: "1" } })
    ).text();
    expect(root).toContain("/dav/files/");
    const scope = await (
      await dav("/files/scope", { key, method: "PROPFIND", headers: { depth: "1" } })
    ).text();
    expect(scope).toContain("/dav/files/scope/in/");
    expect(scope).not.toContain("/dav/files/scope/out/");

    expect(await (await dav("/files/scope/in/a.txt", { key })).text()).toBe("inside");
    expect((await dav("/files/scope/in/new.txt", { key, method: "PUT", body: "x" })).status).toBe(
      201,
    );
    expect((await dav("/files/scope/out/b.txt", { key })).status).toBe(403);
    expect((await dav("/files/scope/out/c.txt", { key, method: "PUT", body: "x" })).status).toBe(
      403,
    );
    expect((await dav("/files/scope/x.txt", { key, method: "PUT", body: "x" })).status).toBe(403);
    expect((await dav("/files/scope", { key, method: "DELETE" })).status).toBe(403);
    const out = { destination: `${server.url}/dav/files/scope/out/moved.txt` };
    expect((await dav("/files/scope/in/a.txt", { key, method: "MOVE", headers: out })).status).toBe(
      403,
    );
    expect((await dav("/files/scope/in/a.txt", { key, method: "COPY", headers: out })).status).toBe(
      403,
    );
    const inside = { destination: `${server.url}/dav/files/scope/in/copy.txt` };
    expect(
      (await dav("/files/scope/in/a.txt", { key, method: "COPY", headers: inside })).status,
    ).toBe(201);
  });

  it("refuses a scope that is not a list of folders", async () => {
    const response = await davloom.api("/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "bad", access: "read-only", paths: ["/"] }),
    });
    expect(response.status).toBe(400);
  });

  it("shows a key's folders in the list", async () => {
    await scopedKey(["/files/listed"], "read-only");
    expect(await (await davloom.api("/api/keys")).json()).toContainEqual(
      expect.objectContaining({ paths: ["/files/listed"], access: "read-only" }),
    );
  });
});

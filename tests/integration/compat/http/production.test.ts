import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { productionRuntimes, type Server } from "./servers";

describe.each(productionRuntimes)("production entry on $name", ({ start }) => {
  let server: Server;

  beforeAll(async () => {
    server = await start();
  });
  afterAll(() => server?.stop());

  it("GET /api/health returns 200", async () => {
    const response = await server.fetch("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

const WEBDAV_METHODS = [
  "OPTIONS",
  "GET",
  "HEAD",
  "PUT",
  "DELETE",
  "PROPFIND",
  "PROPPATCH",
  "MKCOL",
  "COPY",
  "MOVE",
  "LOCK",
  "UNLOCK",
];

// Both runtimes ask for credentials before anything else; http/davloom.test.ts and
// http/selfhosted.test.ts cover the protocol itself.
const EXPECTED: Record<string, number> = { Bun: 401, Workers: 401 };

describe.each(productionRuntimes)("production /dav on $name", ({ name, start }) => {
  let server: Server;
  const status = EXPECTED[name];

  beforeAll(async () => {
    server = await start();
  });
  afterAll(() => server?.stop());

  it.each(WEBDAV_METHODS)("%s without credentials advertises no DAV capability", async (method) => {
    const response = await server.fetch("/dav/a.txt", { method });

    expect(response.status).toBe(status);
    expect(response.headers.has("dav")).toBe(false);
  });

  it("OPTIONS on the root without credentials advertises no DAV capability", async () => {
    const response = await server.fetch("/dav/", { method: "OPTIONS" });

    expect(response.status).toBe(status);
    expect(response.headers.has("dav")).toBe(false);
  });

  it("a method outside WebDAV gets the same answer", async () => {
    const response = await server.fetch("/dav/a.txt", { method: "PATCH" });

    expect(response.status).toBe(status);
  });

  it("PUT with a body is refused without reading the body", async () => {
    const response = await server.fetch("/dav/a.txt", {
      method: "PUT",
      body: "not json",
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(status);
  });

  it("leaves /api/health alone", async () => {
    const response = await server.fetch("/api/health");

    expect(response.status).toBe(200);
  });
});

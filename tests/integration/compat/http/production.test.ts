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

describe.each(productionRuntimes)("production /dav on $name", ({ start }) => {
  let server: Server;

  beforeAll(async () => {
    server = await start();
  });
  afterAll(() => server?.stop());

  it.each(WEBDAV_METHODS)("%s returns 501 with no DAV header", async (method) => {
    const response = await server.fetch("/dav/a.txt", { method });

    expect(response.status).toBe(501);
    expect(response.headers.has("dav")).toBe(false);
  });

  it("OPTIONS on the root returns 501 with no DAV header", async () => {
    const response = await server.fetch("/dav/", { method: "OPTIONS" });

    expect(response.status).toBe(501);
    expect(response.headers.has("dav")).toBe(false);
  });

  it("a method outside WebDAV also returns 501", async () => {
    const response = await server.fetch("/dav/a.txt", { method: "PATCH" });

    expect(response.status).toBe(501);
  });

  it("PUT with a body returns 501 without reading the body", async () => {
    const response = await server.fetch("/dav/a.txt", {
      method: "PUT",
      body: "not json",
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(501);
  });

  it("leaves /api/health alone", async () => {
    const response = await server.fetch("/api/health");

    expect(response.status).toBe(200);
  });
});

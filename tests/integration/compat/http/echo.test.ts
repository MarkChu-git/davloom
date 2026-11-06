import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeRuntimes, productionRuntimes, type Server } from "./servers";

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

const WEBDAV_HEADERS = {
  depth: "1",
  destination: "https://example.com/dav/%E7%9B%AE%E6%A0%87/b.txt",
  if: "(<urn:uuid:181d4fae-7d8c-11d0-a765-00a0c91e6bf2>)",
  "lock-token": "<urn:uuid:181d4fae-7d8c-11d0-a765-00a0c91e6bf2>",
  overwrite: "F",
  timeout: "Second-600",
};

interface Echo {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
}

/** The handler repeats what it received in a header, which also works for HEAD responses. */
const echoOf = (response: Response): Echo => JSON.parse(response.headers.get("x-probe-echo") ?? "");

describe.each(probeRuntimes)("requests reaching the WebDAV handler on $name", ({ start }) => {
  let server: Server;

  beforeAll(async () => {
    server = await start();
  });
  afterAll(() => server?.stop());

  it.each(WEBDAV_METHODS)("%s arrives with its method and path", async (method) => {
    const echo = echoOf(await server.fetch("/dav/a.txt", { method }));

    expect(echo.method).toBe(method);
    expect(echo.path).toBe("/dav/a.txt");
  });

  it.each([
    "/dav/%E6%96%87%E4%BB%B6%20a%2Fb.txt",
    "/dav/a%25b%2Bc.txt",
    "/dav/a%2F..%2Fb",
    "/dav/%E2%82%AC/%F0%9F%93%81/",
  ])("keeps the encoded path %s", async (path) => {
    const echo = echoOf(await server.fetch(path, { method: "PROPFIND" }));

    expect(echo.path).toBe(path);
  });

  it("keeps the WebDAV request headers", async () => {
    const echo = echoOf(
      await server.fetch("/dav/a.txt", { method: "COPY", headers: WEBDAV_HEADERS }),
    );

    expect(echo.headers).toMatchObject(WEBDAV_HEADERS);
  });

  it("does not send /api/health to the handler", async () => {
    const response = await server.fetch("/api/health");

    expect(response.status).toBe(200);
    expect(response.headers.has("x-probe-echo")).toBe(false);
  });
});

describe.each(productionRuntimes)("probe routes on the production entry on $name", ({ start }) => {
  let server: Server;

  beforeAll(async () => {
    server = await start();
  });
  afterAll(() => server?.stop());

  it.each(["/api/__probe/effect/success", "/api/__probe/effect/runtime-builds"])(
    "%s returns 404",
    async (path) => {
      const response = await server.fetch(path);

      expect(response.status).toBe(404);
    },
  );

  it("does not echo requests to /dav", async () => {
    const response = await server.fetch("/dav/a.txt", { method: "PROPFIND" });

    expect(response.headers.has("x-probe-echo")).toBe(false);
  });
});

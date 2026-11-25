import { describe, expect, it } from "vitest";
import { createApp, davOrigin } from "./app";

// The root path `/`: the Dashboard to a browser, the way to /dav/ for a WebDAV client given the
// instance's bare address (Finder's Connect to Server sends OPTIONS, then PROPFIND, to `/`).

const DASHBOARD = "<!doctype html>dashboard";
const served: Request[] = [];
const app = createApp({
  dashboard: (request) => {
    served.push(request);
    return new Response(request.method === "HEAD" ? null : DASHBOARD, {
      headers: { "content-type": "text/html" },
    });
  },
});
const configured = createApp({
  publicOrigin: "https://files.example",
  dashboard: () => new Response(),
});
const bare = createApp();

const send = (target: ReturnType<typeof createApp>, url: string, init?: RequestInit) =>
  target.handle(new Request(url, init));

const DAV_METHODS = [
  "OPTIONS",
  "PROPFIND",
  "PROPPATCH",
  "MKCOL",
  "PUT",
  "DELETE",
  "COPY",
  "MOVE",
  "LOCK",
  "UNLOCK",
];

describe("the root path", () => {
  it.each(["GET", "HEAD"])("serves the Dashboard to %s", async (method) => {
    const response = await send(app, "https://davloom.example/", { method });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    if (method === "GET") expect(await response.text()).toBe(DASHBOARD);
    expect(served.at(-1)?.method).toBe(method);
  });

  it.each([
    ["a body and no length, as Bun's files have", DASHBOARD, {}, String(DASHBOARD.length)],
    ["a length of its own", DASHBOARD, { "content-length": "99" }, "99"],
    ["no body, as Workers static assets answer HEAD", null, {}, null],
  ])("answers HEAD from a Dashboard answer with %s", async (_, body, headers, length) => {
    const head = createApp({
      dashboard: () => {
        const page = new Response(body, { headers: { "content-type": "text/html", ...headers } });
        // Workers static assets give an answer whose headers cannot change.
        Object.freeze(page.headers);
        return page;
      },
    });
    const response = await send(head, "https://davloom.example/", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.get("content-length")).toBe(length);
    expect(await response.text()).toBe("");
  });

  it.each(DAV_METHODS)("sends %s on to /dav/ with a 308", async (method) => {
    const before = served.length;
    const response = await send(app, "https://davloom.example/", {
      method,
      headers: { depth: "0", "user-agent": "WebDAVFS/3.0.0 (03008000) Darwin/24.0.0 (arm64)" },
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://davloom.example/dav/");
    // A redirect advertises nothing about WebDAV and asks for no credential of its own.
    expect(response.headers.has("dav")).toBe(false);
    expect(response.headers.has("www-authenticate")).toBe(false);
    expect(served.length).toBe(before);
  });

  it.each([
    [
      "the query of the request",
      "https://davloom.example/?x=1",
      {},
      "https://davloom.example/dav/",
    ],
    ["a port", "https://davloom.example:8443/", {}, "https://davloom.example:8443/dav/"],
    [
      "a TLS proxy in front",
      "http://davloom.example/",
      { "x-forwarded-proto": "https" },
      "https://davloom.example/dav/",
    ],
    ["plain HTTP", "http://localhost:3000/", {}, "http://localhost:3000/dav/"],
  ])("names an absolute Location with %s", async (_, url, headers, location) => {
    const response = await send(app, url, { method: "PROPFIND", headers });
    expect(response.headers.get("location")).toBe(location);
  });

  it("names the configured public origin", async () => {
    const response = await send(configured, "http://internal:3000/", { method: "PROPFIND" });
    expect(response.headers.get("location")).toBe("https://files.example/dav/");
  });

  it.each(["POST", "PATCH", "TRACE", "REPORT"])("refuses %s", async (method) => {
    const response = await send(app, "https://davloom.example/", { method });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("answers GET with 404 where nothing serves the Dashboard", async () => {
    expect((await send(bare, "https://davloom.example/")).status).toBe(404);
    expect((await send(bare, "https://davloom.example/", { method: "PROPFIND" })).status).toBe(308);
  });

  it.each(["/index.html", "/files", "/.DS_Store", "/a/"])(
    "leaves %s alone: only the root redirects",
    async (path) => {
      const response = await send(app, `https://davloom.example${path}`, { method: "PROPFIND" });
      expect(response.status).not.toBe(308);
    },
  );
});

describe("davOrigin", () => {
  it.each([
    ["https://a.example/x", {}, undefined, "https://a.example"],
    ["http://a.example/x", { "x-forwarded-proto": "https" }, undefined, "https://a.example"],
    ["http://a.example/x", { "x-forwarded-proto": "HTTPS, http" }, undefined, "https://a.example"],
    ["http://a.example/x", { "x-forwarded-proto": "http" }, undefined, "http://a.example"],
    ["https://a.example/x", { "x-forwarded-proto": "http" }, undefined, "https://a.example"],
    ["http://a.example/x", {}, "https://b.example", "https://b.example"],
  ])("%s with %j and %s is %s", (url, headers, publicOrigin, expected) => {
    expect(davOrigin(new Request(url, { headers }), publicOrigin)).toBe(expected);
  });
});

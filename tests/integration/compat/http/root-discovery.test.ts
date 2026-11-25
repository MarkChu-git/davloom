import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  basic,
  OFFLINE_VARS,
  SECRET,
  startDavloom,
  startWorkersServer,
  type Davloom,
} from "./davloom";
import { has } from "./real-clients";
import { startBunServer, type Server } from "./servers";

// A WebDAV client given the instance's bare address, https://host/, as macOS Finder's Connect to
// Server is: Finder's webdavfs sends OPTIONS and then PROPFIND Depth 0 to `/`, and on any 3xx
// of either takes the absolute URL that Location names as its base. The root answers those with a
// 308 to /dav/, where WebDAV asks for credentials as always, and keeps serving the Dashboard to
// GET and HEAD. Both production entries: the Worker in local workerd, where Workers static assets
// would answer 405 unless the Worker runs first for `/`, and the Bun server.

const RUNTIMES: readonly [string, () => Promise<Server>][] = [
  ["Workers", startWorkersServer],
  [
    "Bun",
    () =>
      startBunServer("apps/api/src/entry.bun.ts", {
        DAVLOOM_SECRET: SECRET,
        ...OFFLINE_VARS,
        DAVLOOM_DATA_DIR: mkdtempSync(join(tmpdir(), "davloom-root-")),
      }),
  ],
];

const FINDER = "WebDAVFS/3.0.0 (03008000) Darwin/24.0.0 (arm64)";
const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>';

// Each method a WebDAV client may send to the address it was given, with the headers Finder sends.
const REDIRECTED: readonly [string, RequestInit][] = [
  ["OPTIONS", { headers: { accept: "*/*", "user-agent": FINDER } }],
  [
    "PROPFIND",
    {
      headers: { depth: "0", "content-type": "text/xml", "user-agent": FINDER },
      body: PROPFIND_BODY,
    },
  ],
  ["PROPPATCH", { body: "<x/>" }],
  ["MKCOL", {}],
  ["PUT", { body: "hello" }],
  ["DELETE", {}],
  ["COPY", { headers: { destination: "/elsewhere" } }],
  ["MOVE", { headers: { destination: "/elsewhere" } }],
  ["LOCK", { body: "<x/>" }],
  ["UNLOCK", { headers: { "lock-token": "<urn:x>" } }],
];

describe.each(RUNTIMES)("the root address on %s", (_name, start) => {
  let davloom: Davloom;

  beforeAll(async () => {
    davloom = await startDavloom(start);
  }, 180_000);
  afterAll(() => davloom?.server.stop());

  it("serves the Dashboard to a browser's GET / as before", async () => {
    const response = await davloom.server.fetch("/", {
      headers: { accept: "text/html", "sec-fetch-mode": "navigate" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await response.text()).toMatch(/<!doctype html>/i);
  });

  it("answers HEAD / like GET /", async () => {
    const response = await davloom.server.fetch("/", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
  });

  it.each(REDIRECTED)("sends %s / on to /dav/ with a 308", async (method, init) => {
    const response = await davloom.server.fetch("/", { ...init, method, redirect: "manual" });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`${davloom.server.url}/dav/`);
    expect(response.headers.has("dav")).toBe(false);
    await response.body?.cancel();
  });

  it.each(["POST", "PATCH"])("refuses %s /", async (method) => {
    const response = await davloom.server.fetch("/", { method, redirect: "manual" });
    expect(response.status).toBe(405);
    await response.body?.cancel();
  });

  it("asks for credentials at /dav/ as before, so Finder prompts for them", async () => {
    for (const method of ["OPTIONS", "PROPFIND"]) {
      const response = await davloom.server.fetch("/dav/", {
        method,
        headers: { depth: "0", "user-agent": FINDER },
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/^Basic realm="Davloom"/);
      await response.body?.cancel();
    }
  });

  it("walks Finder's mount: OPTIONS and PROPFIND at /, then at the Location, with a key", async () => {
    const authorization = basic(davloom.readWriteKey);
    const headers = { authorization, "user-agent": FINDER, depth: "0" };
    const options = await davloom.server.fetch("/", {
      method: "OPTIONS",
      headers,
      redirect: "manual",
    });
    const base = options.headers.get("location") ?? "";
    expect(options.status).toBe(308);
    const level = await fetch(base, { method: "OPTIONS", headers });
    expect(level.status).toBe(200);
    expect(level.headers.get("dav")).toMatch(/\b2\b/);
    const stat = await fetch(base, { method: "PROPFIND", headers, body: PROPFIND_BODY });
    expect(stat.status).toBe(207);
    expect(await stat.text()).toMatch(/<(\w+:)?collection\s*\/>/);
  });

  it("follows the 308 with fetch, which keeps the method, the body and the credential", async () => {
    const response = await davloom.server.fetch("/", {
      method: "PROPFIND",
      headers: { authorization: basic(davloom.readWriteKey), depth: "1" },
      body: PROPFIND_BODY,
    });
    expect(response.status).toBe(207);
    expect(await response.text()).toMatch(/<D:href>\/dav\/<\/D:href>/);
  });

  it.skipIf(!has("curl"))("curl -L reaches the WebDAV root from the root address", () => {
    const result = spawnSync(
      "curl",
      [
        "-sS",
        "-L",
        "-X",
        "PROPFIND",
        "-H",
        "Depth: 1",
        "-u",
        `davloom:${davloom.readWriteKey}`,
        "-w",
        "\n%{http_code} %{num_redirects}",
        `${davloom.server.url}/`,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/<D:href>\/dav\/<\/D:href>/);
    expect(result.stdout.trimEnd().endsWith("207 1")).toBe(true);
  });
});

// The Bun server starts and serves the API and WebDAV before the Dashboard has been built, and
// answers the Dashboard's paths with a page that says so instead of failing.
describe("the Bun server without a Dashboard build", () => {
  let server: Server;

  beforeAll(async () => {
    server = await startBunServer("apps/api/src/entry.bun.ts", {
      DAVLOOM_SECRET: SECRET,
      ...OFFLINE_VARS,
      DAVLOOM_DATA_DIR: mkdtempSync(join(tmpdir(), "davloom-root-")),
      DASHBOARD_DIRECTORY: mkdtempSync(join(tmpdir(), "davloom-no-dashboard-")),
    });
  }, 180_000);
  afterAll(() => server?.stop());

  it.each(["/", "/files", "/assets/app.js", "/settings"])(
    "answers GET %s with 503 and keeps running",
    async (path) => {
      const response = await server.fetch(path);
      expect(response.status).toBe(503);
      expect(await response.text()).toContain("The Dashboard has not been built");
    },
  );

  it("serves the API and WebDAV", async () => {
    expect((await server.fetch("/api/health")).status).toBe(200);
    const dav = await server.fetch("/dav/", { method: "PROPFIND" });
    expect(dav.status).toBe(401);
    await dav.body?.cancel();
    const root = await server.fetch("/", { method: "PROPFIND", redirect: "manual" });
    expect(root.status).toBe(308);
  });

  it("says once in its log that the Dashboard is missing", () => {
    const said = (server.logs?.() ?? "").split("The Dashboard has not been built").length - 1;
    expect(said).toBe(1);
  });
});

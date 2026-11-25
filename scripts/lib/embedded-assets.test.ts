import { describe, expect, it } from "vitest";
import {
  createAssetServer,
  DEFAULT_CACHE_CONTROL,
  matchesPattern,
  parseHeaders,
  resolveAsset,
  type EmbeddedFile,
} from "./embedded-assets";

// The embedded Dashboard of the fallback deploy answers as Workers static assets do.

const file = (text: string, type = "text/html;charset=utf-8"): EmbeddedFile => ({
  type,
  base64: btoa(text),
  etag: `"${text.length}-${text}"`.replaceAll(" ", ""),
});

const FILES: Record<string, EmbeddedFile> = {
  "/index.html": file("index"),
  "/files.html": file("files"),
  "/design-check/index.html": file("design"),
  "/robots.txt": { type: "text/plain;charset=utf-8", text: "robots", etag: '"r"' },
  "/assets/app-1.js": file("app", "text/javascript;charset=utf-8"),
  "/favicon.svg": file("svg", "image/svg+xml"),
};

const HEADERS = `# A comment
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/robots.txt
  X-Robots: yes
  ! ETag
`;

const serve = createAssetServer(FILES, HEADERS);
const get = (path: string, init?: RequestInit) =>
  serve(new Request(`https://davloom.example${path}`, init));

describe("resolveAsset", () => {
  it.each([
    ["/", "/index.html"],
    ["/index.html", "/index.html"],
    ["/files", "/files.html"],
    ["/files/", "/files.html"],
    ["/files.html", "/files.html"],
    ["/design-check", "/design-check/index.html"],
    ["/design-check/", "/design-check/index.html"],
    ["/settings", "/index.html"],
    ["/files/deep/path", "/index.html"],
    ["/assets/app-1.js", "/assets/app-1.js"],
    ["/assets/missing.js", null],
    ["/missing.txt", null],
    ["/__proto__", "/index.html"],
    ["/constructor.html", null],
  ])("%s serves %s", (pathname, expected) => {
    expect(resolveAsset(FILES, pathname)?.path ?? null).toBe(expected);
  });

  it("finds nothing without an index.html to fall back to", () => {
    expect(resolveAsset({}, "/settings")).toBeNull();
  });
});

describe("parseHeaders and matchesPattern", () => {
  it("reads rules, set and unset headers, and skips comments and stray lines", () => {
    expect(parseHeaders(`  Orphan: 1\n${HEADERS}/x\n  not a header\n`)).toEqual([
      {
        pattern: "/assets/*",
        set: [["Cache-Control", "public, max-age=31536000, immutable"]],
        unset: [],
      },
      { pattern: "/robots.txt", set: [["X-Robots", "yes"]], unset: ["ETag"] },
      { pattern: "/x", set: [], unset: [] },
    ]);
  });

  it.each([
    ["/assets/*", "/assets/a.js", true],
    ["/assets/*", "/assets/deep/a.js", true],
    ["/assets/*", "/assetsx", false],
    ["/robots.txt", "/robots.txt", true],
    ["/robots.txt", "/robotsxtxt", false],
    ["/*.html", "/files.html", true],
  ])("%s matches %s: %s", (pattern, pathname, expected) => {
    expect(matchesPattern(pattern, pathname)).toBe(expected);
  });
});

describe("the embedded asset server", () => {
  it.each([
    ["/", 200, "index", "text/html;charset=utf-8", DEFAULT_CACHE_CONTROL],
    ["/files", 200, "files", "text/html;charset=utf-8", DEFAULT_CACHE_CONTROL],
    ["/settings", 200, "index", "text/html;charset=utf-8", DEFAULT_CACHE_CONTROL],
    [
      "/assets/app-1.js",
      200,
      "app",
      "text/javascript;charset=utf-8",
      "public, max-age=31536000, immutable",
    ],
    ["/robots.txt", 200, "robots", "text/plain;charset=utf-8", DEFAULT_CACHE_CONTROL],
    ["/missing.js", 404, "", null, null],
    ["/%E0%A4%A", 404, "", null, null],
  ])("GET %s answers %i", async (path, status, body, type, cacheControl) => {
    const response = get(path);
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(body);
    expect(response.headers.get("content-type")).toBe(type);
    expect(response.headers.get("cache-control")).toBe(cacheControl);
  });

  it("applies the set and unset headers of _headers", async () => {
    const response = get("/robots.txt");
    expect(response.headers.get("x-robots")).toBe("yes");
    expect(response.headers.has("etag")).toBe(false);
  });

  it("answers HEAD with the headers and the length, without a body", async () => {
    const response = get("/files", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("5");
    expect(await response.text()).toBe("");
  });

  it.each([
    [FILES["/files.html"]?.etag ?? "", 304],
    [`W/${FILES["/files.html"]?.etag ?? ""}`, 304],
    [`"other", ${FILES["/files.html"]?.etag ?? ""}`, 304],
    ["*", 304],
    ['"other"', 200],
  ])("answers If-None-Match %s with %i", async (tag, status) => {
    const response = get("/files", { headers: { "if-none-match": tag } });
    expect(response.status).toBe(status);
    if (status === 304) {
      expect(await response.text()).toBe("");
      expect(response.headers.get("etag")).toBe(FILES["/files.html"]?.etag);
    }
  });

  it.each(["POST", "PUT", "PROPFIND", "OPTIONS"])("refuses %s with 405", async (method) => {
    const response = get("/files", { method });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("serves binary bytes unchanged", async () => {
    const bytes = new Uint8Array([0, 255, 128, 10]);
    const server = createAssetServer({
      "/a.bin": {
        type: "application/octet-stream",
        base64: btoa(String.fromCharCode(...bytes)),
        etag: '"b"',
      },
    });
    const response = server(new Request("https://davloom.example/a.bin"));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});

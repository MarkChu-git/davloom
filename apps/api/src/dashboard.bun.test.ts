import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { acceptsGzip, createDashboardHandler } from "./dashboard.bun";

// The Dashboard's build served from disk, against a directory made for the test.

const LARGE_SCRIPT = `export const rows = [${Array.from({ length: 400 }, (_, i) => `"row ${i}"`).join(",")}];`;
const LARGE_PAGE = `<!doctype html><title>Davloom</title>${"<p>Davloom</p>".repeat(200)}`;
const PNG = "\u0089PNG not really, but named as one. ".repeat(100);

const root = mkdtempSync(join(tmpdir(), "davloom-dashboard-"));
mkdirSync(join(root, "assets"));
writeFileSync(join(root, "index.html"), "<!doctype html>index");
writeFileSync(join(root, "assets", "app.js"), "console.log(1)");
writeFileSync(join(root, "assets", "large.js"), LARGE_SCRIPT);
writeFileSync(join(root, "robots.txt"), "User-agent: *\n");
writeFileSync(join(root, "files.html"), "<!doctype html>files");
mkdirSync(join(root, "design-check", "deep"), { recursive: true });
writeFileSync(join(root, "design-check", "deep", "page.html"), "<!doctype html>deep");
writeFileSync(join(root, "..", "davloom-outside.txt"), "secret");
// A build whose index.html is large enough to compress.
const largeRoot = mkdtempSync(join(tmpdir(), "davloom-dashboard-"));
mkdirSync(join(largeRoot, "assets"));
writeFileSync(join(largeRoot, "index.html"), LARGE_PAGE);
writeFileSync(join(largeRoot, "assets", "large.js"), LARGE_SCRIPT);
writeFileSync(join(largeRoot, "assets", "app.js"), "console.log(1)");
writeFileSync(join(largeRoot, "assets", "mark.png"), PNG);
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(largeRoot, { recursive: true, force: true });
});

const serve = createDashboardHandler(root);
const get = (path: string, method = "GET") =>
  serve(new Request(`http://davloom.test${path}`, { method }));

describe("the Dashboard handler", () => {
  it.each([
    ["/assets/app.js", 200, "console.log(1)"],
    ["/", 200, "<!doctype html>index"],
    ["/settings", 200, "<!doctype html>index"],
    ["/files", 200, "<!doctype html>files"],
    ["/files/", 200, "<!doctype html>files"],
    ["/design-check/deep/page", 200, "<!doctype html>deep"],
    ["/design-check/deep", 200, "<!doctype html>index"],
    ["/files.html", 200, "<!doctype html>files"],
    ["/files/deep/path", 200, "<!doctype html>index"],
    ["/missing.js", 404, ""],
    ["/api/me", 404, ""],
    ["/dav/files/", 404, ""],
    ["/%E0%A4%A", 404, ""],
    ["/a%00b", 404, ""],
    ["/..%2Fdavloom-outside.txt", 404, ""],
    ["/%2E%2E/davloom-outside.txt", 404, ""],
  ])("GET %s answers %i", async (path, status, text) => {
    const response = await get(path);
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(text);
  });

  it.each(["POST", "PUT", "DELETE"])("refuses %s with the methods it allows", async (method) => {
    const response = await get("/", method);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("answers HEAD", async () => {
    expect((await get("/assets/app.js", "HEAD")).status).toBe(200);
  });

  it.each([
    ["/assets/app.js", "public, max-age=31536000, immutable"],
    ["/assets/large.js", "public, max-age=31536000, immutable"],
    ["/", "public, max-age=0, must-revalidate"],
    ["/settings", "public, max-age=0, must-revalidate"],
    ["/robots.txt", "public, max-age=0, must-revalidate"],
  ])("answers %s with Cache-Control %s", async (path, cacheControl) => {
    expect((await get(path)).headers.get("cache-control")).toBe(cacheControl);
  });
});

describe("the Dashboard handler's compression", () => {
  const serveLarge = createDashboardHandler(largeRoot);
  const withEncoding = (path: string, acceptEncoding?: string) =>
    serveLarge(
      new Request(`http://davloom.test${path}`, {
        headers: acceptEncoding === undefined ? {} : { "accept-encoding": acceptEncoding },
      }),
    );

  it.each([
    ["/assets/large.js", LARGE_SCRIPT],
    ["/", LARGE_PAGE],
    ["/files/deep/path", LARGE_PAGE],
  ])("gzips %s for a client that takes gzip", async (path, text) => {
    const response = await withEncoding(path, "gzip, deflate, br");
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("accept-encoding");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.byteLength).toBeLessThan(text.length / 4);
    expect(new TextDecoder().decode(Bun.gunzipSync(body))).toBe(text);
  });

  it.each([undefined, "identity", "br", "gzip;q=0", "*;q=0", "gzip;q=0, *"])(
    "sends the file as it is for Accept-Encoding %s",
    async (acceptEncoding) => {
      const response = await withEncoding("/assets/large.js", acceptEncoding);
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(response.headers.get("vary")).toBe("accept-encoding");
      expect(await response.text()).toBe(LARGE_SCRIPT);
    },
  );

  it.each([
    ["a file too small to gain", "/assets/app.js", "console.log(1)"],
    ["an image that is compressed already", "/assets/mark.png", PNG],
  ])("does not gzip %s", async (_, path, text) => {
    const response = await withEncoding(path, "gzip");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("vary")).toBeNull();
    expect(await response.text()).toBe(text);
  });

  it("gzips a file again once it has changed", async () => {
    const path = join(largeRoot, "assets", "changing.js");
    writeFileSync(path, "a".repeat(4096));
    const first = await withEncoding("/assets/changing.js", "gzip");
    expect(new TextDecoder().decode(Bun.gunzipSync(await first.bytes()))).toBe("a".repeat(4096));
    writeFileSync(path, "b".repeat(8192));
    const second = await withEncoding("/assets/changing.js", "gzip");
    expect(new TextDecoder().decode(Bun.gunzipSync(await second.bytes()))).toBe("b".repeat(8192));
  });
});

describe("acceptsGzip", () => {
  it.each([
    [null, false],
    ["", false],
    ["gzip", true],
    ["GZIP", true],
    ["x-gzip", true],
    ["deflate, gzip;q=0.5", true],
    ["gzip;q=0", false],
    ["gzip; q=0.000", false],
    ["*", true],
    ["*;q=0", false],
    ["gzip;q=0, *", false],
    ["*;q=0, gzip", true],
    ["br, identity", false],
    ["gzip;q=nonsense", false],
  ])("reads %j as %s", (header, accepted) => {
    expect(acceptsGzip(header)).toBe(accepted);
  });
});

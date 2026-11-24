import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDashboardHandler } from "./dashboard.bun";

// The Dashboard's build served from disk, against a directory made for the test.

const root = mkdtempSync(join(tmpdir(), "davloom-dashboard-"));
mkdirSync(join(root, "assets"));
writeFileSync(join(root, "index.html"), "<!doctype html>index");
writeFileSync(join(root, "assets", "app.js"), "console.log(1)");
writeFileSync(join(root, "..", "davloom-outside.txt"), "secret");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const serve = createDashboardHandler(root);
const get = (path: string, method = "GET") =>
  serve(new Request(`http://davloom.test${path}`, { method }));

describe("the Dashboard handler", () => {
  it.each([
    ["/assets/app.js", 200, "console.log(1)"],
    ["/", 200, "<!doctype html>index"],
    ["/settings", 200, "<!doctype html>index"],
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
});

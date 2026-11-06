import { connect } from "node:net";
import { expect, test } from "@playwright/test";

test("opening a deep route directly renders that route", async ({ page }) => {
  const response = await page.goto("/design-check/deep/page");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Deep route" })).toBeVisible();
});

test("the API keeps its own 404s instead of falling back to the Dashboard", async ({ request }) => {
  const response = await request.get("/api/does-not-exist");

  expect(response.status()).toBe(404);
});

test("a missing asset is a 404, not the Dashboard", async ({ request }, testInfo) => {
  // The SPA fallback of Workers static assets answers every unmatched path with index.html.
  test.skip(testInfo.project.name === "workers", "Workers static assets have no such distinction");

  const response = await request.get("/assets/does-not-exist.js");

  expect(response.status()).toBe(404);
});

for (const method of ["GET", "PROPFIND"]) {
  test(`WebDAV routes still receive ${method}`, async ({ request }) => {
    const response = await request.fetch("/dav/a.txt", { method });

    expect(response.status()).toBe(501);
  });
}

test("only reads can reach the Dashboard", async ({ request }) => {
  const response = await request.post("/design-check");

  expect(response.status()).toBe(405);
});

// apps/web/dist/client/../../package.json is apps/web/package.json, a file that really exists.
const MANIFEST_NAME = '"name": "@davloom/web"';

const rawGet = (port: number, path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let response = "";
    socket.on("data", (chunk) => {
      response += chunk.toString();
    });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });

for (const path of ["/..%2f..%2fpackage.json", "/%2e%2e%2f%2e%2e%2fpackage.json"]) {
  test(`an encoded climb out of the build directory stays inside: ${path}`, async ({ request }) => {
    const response = await request.get(path);

    expect(await response.text()).not.toContain(MANIFEST_NAME);
  });
}

test("a literal climb out of the build directory stays inside", async ({ baseURL }) => {
  const port = Number(new URL(baseURL ?? "").port);

  expect(await rawGet(port, "/../../package.json")).not.toContain(MANIFEST_NAME);
});

test("a null byte in the path is not a server error", async ({ request }) => {
  const response = await request.get("/%00");

  expect(response.status()).toBeLessThan(500);
});

test("the bare API path is the API's own 404", async ({ request }) => {
  const response = await request.get("/api");

  expect(response.status()).toBe(404);
});

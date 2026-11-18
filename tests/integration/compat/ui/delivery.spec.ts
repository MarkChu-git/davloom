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

/**
 * The shapes of an SVG drawing: every element under its root but a style, with its attributes
 * sorted and each id named by the order it first appears in, so that React's generated ids compare
 * equal to the favicon's.
 */
const shapesOf = (root: Element) => {
  const names = new Map<string, string>();
  const name = (id: string) => names.get(id) ?? names.set(id, `#${names.size + 1}`).get(id);
  return [...root.querySelectorAll("*")]
    .filter((element) => element.localName !== "style")
    .map((element) =>
      [
        element.localName,
        ...[...element.attributes]
          .map(({ name: attribute, value }) =>
            attribute === "id"
              ? `id=${name(value)}`
              : `${attribute}=${value.replace(/^url\(#(.+)\)$/, (_, id: string) => `url(${name(id)})`)}`,
          )
          .toSorted(),
      ].join(" "),
    );
};

test("the favicon is the mark: an SVG of its shapes, in its color in either scheme", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute("type", "image/svg+xml");
  const href = (await icon.getAttribute("href")) ?? "";
  const response = await request.get(href);

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");

  const mark = page.getByRole("link", { name: "Davloom" }).locator("svg").first();
  const favicon = await page.evaluateHandle(
    (source) => new DOMParser().parseFromString(source, "image/svg+xml").documentElement,
    await response.text(),
  );
  expect(await favicon.evaluate(shapesOf)).toEqual(await mark.evaluate(shapesOf));

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // A pixel inside the planet, with the favicon drawn the way the browser draws an image.
    const ink = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext("2d");
      context?.drawImage(image, 0, 0, 32, 32);
      const [red, green, blue] = context?.getImageData(13, 13, 1, 1).data ?? [];
      return `rgb(${red}, ${green}, ${blue})`;
    }, `${href}?scheme=${colorScheme}`);

    await expect.poll(() => mark.evaluate((svg) => getComputedStyle(svg).color)).toBe(ink);
  }
});

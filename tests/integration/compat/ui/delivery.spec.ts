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
  test(`WebDAV routes still receive ${method}`, async ({ request }, testInfo) => {
    const response = await request.fetch("/dav/a.txt", { method });

    // Bun serves no storage yet (501). The Worker asks for credentials (401), since this request
    // has none, instead of handing the path to the Dashboard.
    expect(response.status()).toBe(testInfo.project.name === "workers" ? 401 : 503);
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
 * The shapes of an SVG drawing: its viewBox, then every element under its root but a style, with
 * its attributes sorted and each id named by the order it first appears in, so that React's
 * generated ids compare equal to the favicon's.
 */
const shapesOf = (root: Element) => {
  const names = new Map<string, string>();
  const name = (id: string) => names.get(id) ?? names.set(id, `#${names.size + 1}`).get(id);
  return [
    `viewBox=${root.getAttribute("viewBox")}`,
    ...[...root.querySelectorAll("*")]
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
      ),
  ];
};

/**
 * Draws the favicon at `source` and a copy of the mark, with the mark's color written in, at 96 px
 * each, and counts the color channels of their pixels that differ. A style in the favicon, such as
 * one that hides a shape, shows here, where the list of shapes above would miss it.
 */
const differingChannels = async (mark: Element, source: string) => {
  const size = 96;
  const draw = async (url: string) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context?.drawImage(image, 0, 0, size, size);
    return context?.getImageData(0, 0, size, size).data;
  };
  const copy = mark.cloneNode(true);
  if (!(copy instanceof Element)) {
    return Number.NaN;
  }
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.removeAttribute("class");
  copy.setAttribute("style", `color: ${getComputedStyle(mark).color}`);
  const [drawn, favicon] = await Promise.all([
    draw(`data:image/svg+xml,${encodeURIComponent(copy.outerHTML)}`),
    draw(source),
  ]);
  if (drawn === undefined || favicon === undefined) {
    return Number.NaN;
  }
  return drawn.filter((channel, index) => channel !== favicon[index]).length;
};

// Signed out, so the Worker shows the sign-in page too.
test.describe(() => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("the favicon is the mark: the same shapes, drawn pixel for pixel alike in either scheme", async ({
    page,
    request,
  }) => {
    // The sign-in page draws the mark on every server, also on Bun, which runs no API yet.
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    const icon = page.locator('link[rel="icon"]');
    await expect(icon).toHaveAttribute("type", "image/svg+xml");
    const href = (await icon.getAttribute("href")) ?? "";
    const response = await request.get(href);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/svg+xml");

    // The mark leads the page, above the form.
    const mark = page.locator("svg").first();
    const favicon = await page.evaluateHandle(
      (source) => new DOMParser().parseFromString(source, "image/svg+xml").documentElement,
      await response.text(),
    );
    expect(await favicon.evaluate(shapesOf)).toEqual(await mark.evaluate(shapesOf));

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });

      await expect
        .poll(() => mark.evaluate(differingChannels, `${href}?scheme=${colorScheme}`))
        .toBe(0);
    }
  });
});

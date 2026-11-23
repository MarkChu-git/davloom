import { expect, test, type Page } from "@playwright/test";
import {
  blockClipboard,
  cardWith,
  levelOne,
  onScreen,
  shown,
  withUnavailableBackend,
} from "./helpers";
import { api, WORKERS_ORIGIN } from "./instances";

// The Overview's scenarios about what the API reports and what its controls do. Other tests add
// files, backends and mounts to the same instance at the same time, so each check compares the
// page with an answer of the API read just before, and tries again when a change slipped between.

interface Overview {
  usage: { files: number; collections: number; bytes: number };
  mounts: { name: string; backendId: string }[];
  backends: { id: string; name: string; available: boolean }[];
}

const overview = async (page: Page): Promise<Overview> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the API's own answer
  (await api(page.request, "GET", "/api/overview")) as Overview;

const bytes = (count: number): string => {
  const units = [
    ["byte", 1],
    ["kilobyte", 1e3],
    ["megabyte", 1e6],
    ["gigabyte", 1e9],
  ] as const;
  const [unit, size] = units.findLast(([, step]) => count >= step) ?? units[0];
  return new Intl.NumberFormat("en", {
    style: "unit",
    unit,
    unitDisplay: unit === "byte" ? "long" : "short",
    maximumFractionDigits: unit === "byte" ? 0 : 1,
  }).format(count / size);
};

const count = new Intl.NumberFormat("en");

test("Figures from the API: the tiles read the bytes stored, the files and folders, the mounts and the backends", async ({
  page,
}) => {
  await expect(async () => {
    const answer = await overview(page);
    await page.goto("/");
    const tile = (label: string) => cardWith(page, page.getByText(label, { exact: true }));
    await expect(tile("Stored").getByText(bytes(answer.usage.bytes), { exact: true })).toBeVisible({
      timeout: 2_000,
    });
    await expect(tile("Stored")).toContainText(
      `${count.format(answer.usage.files)} files in ${count.format(answer.usage.collections)} folders`,
      { timeout: 2_000 },
    );
    await expect(
      tile("Mounts").getByText(count.format(answer.mounts.length), { exact: true }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(
      tile("Backends").getByText(count.format(answer.backends.length), { exact: true }),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
});

test("Bytes on each backend: the storage chart names every backend with its size, and Manage storage opens Storage & Mounts", async ({
  page,
}) => {
  await page.goto("/");
  const chart = page.getByRole("img", { name: "Bytes stored on each backend" });
  await expect(chart.locator("text").filter({ hasText: /^Default$/ })).toHaveCount(1);
  // The size stands at the tip of the bar, on the backend's own row.
  const labels = await chart.locator("text").evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent ?? "",
      top: node.getBoundingClientRect().top,
    })),
  );
  const name = labels.find((label) => label.text === "Default");
  const size = labels.find((label) => /\d (bytes?|kB|MB|GB)$/.test(label.text));
  expect(name).toBeDefined();
  expect(size).toBeDefined();
  expect(Math.abs((size?.top ?? 0) - (name?.top ?? 100))).toBeLessThan(4);

  await page.getByRole("link", { name: "Manage storage" }).click();
  await expect(levelOne(page)).toHaveText("Storage & Mounts");
  await expect(page).toHaveURL(/\/storage$/);
});

test("Connections: the default backend is available, with its kind and the mount it serves", async ({
  page,
}) => {
  await page.goto("/");
  const connections = cardWith(page, page.getByRole("heading", { name: "Connections" }));
  const backend = connections
    .getByRole("listitem")
    .filter({ has: page.getByText("Default", { exact: true }) });
  await expect(backend).toContainText("Cloudflare Durable Objects");
  await expect(backend).toContainText("/files");
  await expect(backend).toContainText("Available");
});

test("A backend that does not answer: the connections list marks it Unavailable, and so does the Backends tile", async ({
  page,
}) => {
  await withUnavailableBackend(page);
  await page.goto("/");
  const connections = cardWith(page, page.getByRole("heading", { name: "Connections" }));
  await expect(
    connections.getByRole("listitem").filter({ hasText: "Default" }).first(),
  ).toContainText("Unavailable");
  await shown(
    cardWith(page, page.getByText("Backends", { exact: true })).getByText(/unavailable$/),
  );
});

test("The mount list: /files opens its folder on Files", async ({ page }) => {
  await page.goto("/");
  const mounts = cardWith(page, page.getByRole("heading", { name: "Mounts", exact: true }));
  await mounts.getByRole("link", { name: /^\/files/ }).click();
  await expect(levelOne(page)).toHaveText("Files");
  await expect(page).toHaveURL(/\/files\?path=%2Ffiles$/);
});

test("Features that do not exist yet: no operations chart, no recent errors and no connection check", async ({
  page,
}) => {
  await page.goto("/");
  await shown(page.getByRole("heading", { name: "Connections" }));
  await expect(page.getByRole("heading", { name: "Operations" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recent operation errors" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check connections" })).toHaveCount(0);
});

test("An overview that cannot be read: the page says so, and Try again reads it again", async ({
  page,
}) => {
  let refuse = true;
  await page.route("**/api/overview", (route) =>
    refuse ? route.fulfill({ status: 500, body: "" }) : route.continue(),
  );
  await page.goto("/");
  await shown(page.getByText("Cannot read the overview"));
  refuse = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await shown(cardWith(page, page.getByText("Stored", { exact: true })));
});

test("Copying the address: the clipboard holds the WebDAV address and the button reads Copied", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const copy = page.getByRole("button", { name: "Copy address" });
  await shown(copy);
  // Before the click the button offers to copy, and does not yet say it did.
  await expect(page.getByRole("button", { name: "Copied" })).toHaveCount(0);

  await copy.click();
  await shown(page.getByRole("button", { name: "Copied" }));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${WORKERS_ORIGIN}/dav/`);
});

test("Copying is blocked: the field says the browser blocked copying and asks the user to copy the text", async ({
  page,
}) => {
  await page.goto("/");
  await blockClipboard(page);
  await page.getByRole("button", { name: "Copy address" }).click();

  const blocked = "This browser blocked copying here. Select the text and copy it yourself.";
  await shown(onScreen(page, blocked));
  // The field says it: the message describes the group of the field and its button.
  await expect(page.getByRole("group", { name: "WebDAV address" })).toHaveAccessibleDescription(
    blocked,
  );
  await expect(page.getByRole("button", { name: "Copied" })).toHaveCount(0);
});

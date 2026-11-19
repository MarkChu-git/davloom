import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  blockClipboard,
  boxOf,
  cardWith,
  installClock,
  levelOne,
  onScreen,
  shown,
  stopTimers,
} from "./helpers";

// The Overview's scenarios about what the sample data shows and what its controls do. The ones
// about its layout, a touch screen, a chart's keyboard and mouse, and the recent errors have their
// tests in dashboard.spec.ts.

const operationsChart = (page: Page) =>
  page.getByRole("img", { name: "Operations per hour, last 24 hours" });

/** Where an element's middle is, sideways. */
const centerOf = async (target: Locator): Promise<number> => {
  const { x, width } = await boxOf(target);
  return x + width / 2;
};

/**
 * Where the operations chart draws each hour, sideways, found from the labels of its x axis: the
 * labels for 12 and 6 hours ago are 6 hours apart, and the label Now stands on the latest hour.
 */
const hourPositions = async (chart: Locator) => {
  const label = (text: RegExp | string) => chart.locator("text").filter({ hasText: text });
  const twelve = await centerOf(label(/^12\D/));
  const six = await centerOf(label(/^6\D/));
  const now = await centerOf(label("Now"));
  const hour = (six - twelve) / 6;
  return (hoursAgo: number): number => now - hoursAgo * hour;
};

test("Figures of the sample data: the tiles read the bytes stored, the share of known capacity and the mounts", async ({
  page,
}) => {
  await page.goto("/");
  for (const { label, figure, caption } of [
    { label: "Stored", figure: "255.1 GB", caption: "24,597 objects" },
    { label: "Known capacity", figure: "10.7%", caption: "213.9 GB of 2 TB" },
    { label: "Mounts", figure: "4", caption: "On 3 of 3 backends" },
  ]) {
    const tile = cardWith(page, page.getByText(label, { exact: true }));
    await shown(tile.getByText(figure, { exact: true }));
    await shown(tile.getByText(caption, { exact: true }));
  }
});

test("The last 24 hours: the Operations card counts 3,732 operations with 4 failed, and the chart rings the 3 hours that had a failure", async ({
  page,
}) => {
  await page.goto("/");
  const card = cardWith(page, page.getByRole("heading", { name: "Operations", exact: true }));
  await shown(card.getByText("3,732", { exact: true }));
  await shown(card.getByText("4 failed", { exact: true }));

  // A hollow ring stands on 5 hours ago, 1 hour ago and now, where the sample errors failed.
  const chart = operationsChart(page);
  const rings = chart.locator("circle");
  await expect(rings).toHaveCount(3);
  const at = await hourPositions(chart);
  const found = await Promise.all((await rings.all()).map(centerOf));
  const wanted = [5, 1, 0].map(at).toSorted((a, b) => a - b);
  for (const [index, x] of found.toSorted((a, b) => a - b).entries()) {
    expect(Math.abs(x - (wanted[index] ?? Number.NaN)), `ring ${index + 1} of 3`).toBeLessThan(2);
  }
});

test("Pointing at an hour: the tooltip names the hour under the mouse with its operations, and its failures when it had any", async ({
  page,
}) => {
  await page.goto("/");
  const chart = operationsChart(page);
  const { y, height } = await boxOf(chart);
  const at = await hourPositions(chart);
  const middle = y + height / 2;

  // The tallest hour, with no failure to show.
  await page.mouse.move(at(12), middle);
  await expect(page.getByRole("status", { name: /Operations: / })).toHaveAccessibleName(
    "12 hours ago Operations: 426",
  );

  // An hour with a failed operation says so in a row of its own.
  await page.mouse.move(at(5), middle);
  await expect(page.getByRole("status", { name: /Operations: / })).toHaveAccessibleName(
    "5 hours ago Operations: 216 Failed: 1",
  );
});

test("The sample backends: the storage chart lists RustFS archive, R2 photos and Durable Objects with their bytes, and Manage storage opens Storage & Mounts", async ({
  page,
}) => {
  await page.goto("/");
  const texts = page.getByRole("img", { name: "Bytes stored on each backend" }).locator("text");
  // The chart draws once the page has hydrated: a name and a size for each of the 3 backends.
  await expect(texts).toHaveCount(6);
  const labels = await texts.evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent ?? "",
      top: node.getBoundingClientRect().top,
    })),
  );
  const topOf = (text: string): number =>
    labels.find((label) => label.text === text)?.top ?? Number.NaN;

  // A bar for each backend, largest first, with its size at the bar's tip on the bar's own row.
  const rows = [
    { name: "RustFS archive", size: "212 GB" },
    { name: "R2 photos", size: "41.2 GB" },
    { name: "Durable Objects", size: "1.9 GB" },
  ];
  for (const [index, { name, size }] of rows.entries()) {
    expect(Math.abs(topOf(size) - topOf(name)), `${name}'s size on its row`).toBeLessThan(4);
    const next = rows[index + 1];
    if (next !== undefined) {
      expect(topOf(next.name), `${next.name} under ${name}`).toBeGreaterThan(topOf(name));
    }
  }

  await page.getByRole("link", { name: "Manage storage" }).click();
  await expect(levelOne(page)).toHaveText("Storage & Mounts");
  expect(new URL(page.url()).pathname).toBe("/storage");
});

test("An unreachable backend: the connections list marks the default backend with its mounts, and RustFS archive unreachable", async ({
  page,
}) => {
  await page.goto("/");
  const connections = cardWith(page, page.getByRole("heading", { name: "Connections" }));
  const backend = (name: string) =>
    connections.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });

  // The default mark leads the line of the mounts the backend serves.
  await expect(backend("Durable Objects")).toContainText("Default · /documents, /shared");
  await expect(backend("Durable Objects")).toContainText("Connected");
  await expect(backend("R2 photos")).not.toContainText("Default");
  await expect(backend("RustFS archive")).toContainText("/archive");
  await expect(backend("RustFS archive")).toContainText("Unreachable");
  await expect(backend("RustFS archive")).not.toContainText("Default");
});

test("Checking connections: the button shows the check running, then an error says RustFS archive is still unreachable", async ({
  page,
}) => {
  await installClock(page);
  await stopTimers(page);
  await page.goto("/");
  const check = page.getByRole("button", { name: "Check connections" });
  const notice = page.locator('.astryx-toast[data-type="error"]');

  await check.click();
  await expect(check).toHaveAttribute("aria-busy", "true");
  await expect(notice).toHaveCount(0);

  // The check ends after a short pause, as it would while the API answers.
  await page.clock.runFor(1000);
  await expect(check).not.toHaveAttribute("aria-busy", "true");
  await expect(notice).toHaveText("Checked 3 backends. RustFS archive is still unreachable.");
  // An error is announced at once, not politely.
  await expect(page.locator('[data-astryx-live-region="assertive"]')).toHaveText(
    "Checked 3 backends. RustFS archive is still unreachable.",
  );
});

test("Copying the address: the clipboard holds the WebDAV address and the button reads Copied", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Copied" })).toHaveCount(0);

  await page.getByRole("button", { name: "Copy address" }).click();
  await shown(page.getByRole("button", { name: "Copied" }));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "https://files.example.com/dav/",
  );
});

test("Copying is blocked: the field says the browser blocked copying and asks the user to copy the text", async ({
  page,
}) => {
  await page.goto("/");
  await blockClipboard(page);
  await page.getByRole("button", { name: "Copy address" }).click();

  await shown(
    onScreen(page, "This browser blocked copying here. Select the text and copy it yourself."),
  );
  await expect(page.getByRole("button", { name: "Copied" })).toHaveCount(0);
});

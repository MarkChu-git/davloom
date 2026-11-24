import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  blockClipboard,
  cardWith,
  engine,
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
  backends: {
    id: string;
    name: string;
    available: boolean;
    capacity?: number | null;
    usage: { bytes: number } | null;
  }[];
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
const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

/** The bytes on the backends that know their limit, and that limit in all, as the tile adds them. */
const knownCapacity = (backends: Overview["backends"]) => {
  const known = backends.filter(
    (backend) => typeof backend.capacity === "number" && backend.capacity > 0,
  );
  return known.length === 0
    ? null
    : {
        used: known.reduce((sum, backend) => sum + (backend.usage?.bytes ?? 0), 0),
        capacity: known.reduce((sum, backend) => sum + (backend.capacity ?? 0), 0),
      };
};

const HOUR = 3_600_000;

/**
 * An answer of /api/operations with a known shape: 24 hours of operations, two of them failed an
 * hour and three hours ago, and those two errors. The real answer counts what other tests do.
 */
const operationsAnswer = (errors = true) => {
  const now = Date.now();
  const thisHour = Math.floor(now / HOUR) * HOUR;
  return {
    hours: Array.from({ length: 24 }, (_, index) => {
      const hoursAgo = 23 - index;
      return {
        start: new Date(thisHour - hoursAgo * HOUR).toISOString(),
        operations: 10 + index,
        failed: errors && (hoursAgo === 1 || hoursAgo === 3) ? 1 : 0,
      };
    }),
    errors: errors
      ? [
          {
            id: "error-1",
            at: new Date(now - 70 * 60_000).toISOString(),
            method: "PUT",
            path: "/files/backups/disk.iso",
            destination: null,
            status: 507,
          },
          {
            id: "error-2",
            at: new Date(now - 3 * HOUR - 5 * 60_000).toISOString(),
            method: "MOVE",
            path: "/files/report.pdf",
            destination: "/files/Archive/report.pdf",
            status: 412,
          },
        ]
      : [],
  };
};

/** Answers the page's reads of /api/operations with `answer`. */
const withOperations = (page: Page, answer: ReturnType<typeof operationsAnswer>) =>
  page.route("**/api/operations", (route) => route.fulfill({ json: answer }));

const panel = (page: Page, title: string) =>
  cardWith(page, page.getByRole("heading", { name: title, exact: true }));

test("Figures from the API: the tiles read the bytes stored, the files and folders, the known capacity, and the mounts on their backends", async ({
  page,
}) => {
  await expect(async () => {
    const answer = await overview(page);
    await page.goto("/");
    // A tile names its figure in a label, where a panel has a heading.
    const tile = (label: string) =>
      cardWith(page, page.getByText(label, { exact: true })).filter({
        hasNot: page.getByRole("heading"),
      });
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
    const known = knownCapacity(answer.backends);
    if (known === null) {
      await expect(tile("Known capacity").getByText("No fixed limit")).toBeVisible({
        timeout: 2_000,
      });
    } else {
      await expect(
        tile("Known capacity").getByText(percent.format(known.used / known.capacity), {
          exact: true,
        }),
      ).toBeVisible({ timeout: 2_000 });
      await expect(tile("Known capacity")).toContainText(
        `${bytes(known.used)} of ${bytes(known.capacity)}`,
        { timeout: 2_000 },
      );
      await expect(
        tile("Known capacity").getByRole("progressbar", { name: "Known capacity used" }),
      ).toBeVisible({ timeout: 2_000 });
    }
    const backendsInUse = new Set(answer.mounts.map((mount) => mount.backendId)).size;
    const backends = answer.backends.length;
    await expect(tile("Mounts")).toContainText(
      `On ${backendsInUse} of ${count.format(backends)} ${backends === 1 ? "backend" : "backends"}`,
      { timeout: 2_000 },
    );
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

test("A backend that does not answer: the connections list marks it Unavailable", async ({
  page,
}) => {
  await withUnavailableBackend(page);
  await page.goto("/");
  const connections = cardWith(page, page.getByRole("heading", { name: "Connections" }));
  await expect(
    connections.getByRole("listitem").filter({ hasText: "Default" }).first(),
  ).toContainText("Unavailable");
  // A backend that stores nothing it can count still has its bar in the storage chart.
  const chart = page.getByRole("img", { name: "Bytes stored on each backend" });
  await expect(chart.locator("text").filter({ hasText: /^Default$/ })).toHaveCount(1);
});

test("The mount list: /files opens its folder on Files", async ({ page }) => {
  await page.goto("/");
  const mounts = cardWith(page, page.getByRole("heading", { name: "Mounts", exact: true }));
  await mounts.getByRole("link", { name: /^\/files/ }).click();
  await expect(levelOne(page)).toHaveText("Files");
  await expect(page).toHaveURL(/\/files\?path=%2Ffiles$/);
});

test("Operations: the panel counts the last 24 hours, says how many failed, and charts each hour", async ({
  page,
}) => {
  const answer = operationsAnswer();
  await withOperations(page, answer);
  await page.goto("/");
  const operations = panel(page, "Operations");
  await expect(operations).toContainText("Last 24 hours");
  const total = answer.hours.reduce((sum, hour) => sum + hour.operations, 0);
  await shown(operations.getByText(count.format(total), { exact: true }));
  await shown(operations.getByText("2 failed", { exact: true }));
  const chart = operations.getByRole("img", { name: "Operations per hour, last 24 hours" });
  await shown(chart);
  // The chart describes itself in words for those who cannot see it.
  await expect(chart).toContainText(`${count.format(total)} operations, 2 of them failed`);
});

test("Operations that cannot be read: the panel says so, and Try again reads them again", async ({
  page,
}) => {
  let refuse = true;
  await page.route("**/api/operations", (route) =>
    refuse ? route.fulfill({ status: 500, body: "" }) : route.fulfill({ json: operationsAnswer() }),
  );
  await page.goto("/");
  const operations = panel(page, "Operations");
  await shown(operations.getByText("Cannot read the operations"));
  refuse = false;
  await operations.getByRole("button", { name: "Try again" }).click();
  await shown(operations.getByRole("img", { name: "Operations per hour, last 24 hours" }));
});

test("Recent operation errors: the list opens each error in place, and the view switches to a timeline and to tiles", async ({
  page,
}) => {
  await withOperations(page, operationsAnswer());
  await page.goto("/");
  const errors = panel(page, "Recent operation errors");
  const views = errors.getByRole("radiogroup", { name: "Show errors as" });
  // The list is the view until another is chosen.
  await expect(views.getByRole("radio", { name: "List" })).toBeChecked();

  const toggle = errors.getByRole("button", { name: "Details for disk.iso", exact: true });
  await shown(toggle);
  await shown(errors.getByRole("button", { name: "Details for report.pdf", exact: true }));
  await toggle.click();
  const details = errors.getByRole("group", { name: "Details for disk.iso", exact: true });
  await expect(details).toContainText("507");
  await expect(details).toContainText("Storage full");
  await expect(details).toContainText("/files/backups/disk.iso");
  await expect(details).toContainText("The backend has no room left.");

  await views.getByRole("radio", { name: "Timeline" }).click();
  await shown(errors.getByRole("img", { name: "Operation errors, last 24 hours" }));
  await expect(toggle).toHaveCount(0);

  await views.getByRole("radio", { name: "Tiles" }).click();
  const tile = errors.getByRole("button", { name: /^report\.pdf, Already exists, / });
  await shown(tile);
  // The tile is a button under its face: a key opens it, as a click on its face does.
  await tile.focus();
  await page.keyboard.press("Enter");
  const popover = page.getByRole("dialog", { name: "report.pdf" });
  await expect(popover).toContainText("412");
  await expect(popover).toContainText("/files/report.pdf → /files/Archive/report.pdf");

  // The browser remembers the view chosen last.
  await page.reload();
  await expect(
    panel(page, "Recent operation errors").getByRole("radio", { name: "Tiles" }),
  ).toBeChecked();
});

test("No recent operation errors: the panel says that nothing failed in the last 24 hours", async ({
  page,
}) => {
  await withOperations(page, operationsAnswer(false));
  await page.goto("/");
  const errors = panel(page, "Recent operation errors");
  await shown(errors.getByText("No failed operations in the last 24 hours"));
  await expect(panel(page, "Operations").getByText(/failed$/)).toHaveCount(0);
});

test("Checking connections: each backend is asked again, and a notification says how many answered", async ({
  page,
}) => {
  await page.goto("/");
  const connections = panel(page, "Connections");
  const check = connections.getByRole("button", { name: "Check connections" });
  await expect(check).toBeEnabled();
  const asked = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/api/backends/check"),
  );
  await check.click();
  await asked;
  await shown(onScreen(page, /^Checked \d+ backends?\./));
});

test("A connection check that finds a backend down: the notification names it and says why", async ({
  page,
}) => {
  await page.route("**/api/backends/check", (route) =>
    route.fulfill({
      json: [
        {
          id: "default",
          name: "Default",
          available: true,
          latencyMs: 4,
          reason: null,
          checkedAt: new Date().toISOString(),
        },
        {
          id: "offsite",
          name: "Offsite",
          available: false,
          latencyMs: null,
          reason: "timed out",
          checkedAt: new Date().toISOString(),
        },
      ],
    }),
  );
  await page.goto("/");
  await panel(page, "Connections").getByRole("button", { name: "Check connections" }).click();
  await shown(onScreen(page, "Checked 2 backends. Offsite: timed out."));
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
  // Only Chromium lets a test grant reading the clipboard; the others let the page write to it on
  // a click, and the test reads the button's answer.
  const reads = engine() === "chromium";
  if (reads) await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const copy = page.getByRole("button", { name: "Copy address" });
  await shown(copy);
  // Before the click the button offers to copy, and does not yet say it did.
  await expect(page.getByRole("button", { name: "Copied" })).toHaveCount(0);

  await copy.click();
  await shown(page.getByRole("button", { name: "Copied" }));
  if (reads) {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${WORKERS_ORIGIN}/dav/`,
    );
  }
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

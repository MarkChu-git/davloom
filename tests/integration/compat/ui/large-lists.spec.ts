import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { filesAt, listed, shown } from "./helpers";
import { MOUNT, unique } from "./instances";
import { multistatus, type ListedEntry } from "./multistatus";

// Large directory lists (PRD §11): the File Explorer with folders of thousands of files, in desktop
// Chromium. The listing is the server's answer to a PROPFIND, made here, since thousands of uploads
// would take longer than the checks. The page draws only the rows in view (useRowWindow), so the
// document keeps a few dozen rows whatever the folder holds, and the budgets are a person's
// patience on the CI runner, not a benchmark.

const SIZES = [1_000, 2_500, 5_000, 10_000] as const;

/** How long the page may take to show the rows once the listing has arrived, on a CI runner. */
const BUDGET_MS = 5_000;

/** The most rows the document may hold at once, whatever the folder holds. */
const MOST_ROWS = 150;

/** Files named so that name order is number order, the size growing with the number. */
const filesOf = (count: number): ListedEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `file-${String(index + 1).padStart(5, "0")}.txt`,
    bytes: (index + 1) * 10,
    modified: new Date(Date.UTC(2026, 10, 16, 12, 0, 0) - index * 60_000),
    type: "text/plain",
  }));

const nameOf = (number: number) => `file-${String(number).padStart(5, "0")}.txt`;

/** Answers the PROPFIND of a folder of `count` files, and opens it on Files. */
const openLarge = async (page: Page, count: number) => {
  const folder = unique("large");
  const body = multistatus([MOUNT, folder], filesOf(count));
  await page.route(`**/dav/${MOUNT}/${folder}/`, (route) =>
    route.request().method() === "PROPFIND"
      ? route.fulfill({ status: 207, contentType: "application/xml; charset=utf-8", body })
      : route.continue(),
  );
  const answered = page.waitForResponse(
    (response) => response.request().method() === "PROPFIND" && response.status() === 207,
  );
  await page.goto(filesAt(`/${MOUNT}/${folder}`));
  await answered;
  return Date.now();
};

/**
 * Scrolls the listing by `pixels`, or to its end: the element that scrolls it is the nearest one
 * around the table that scrolls, else the page (features/files/useRowWindow.ts).
 */
const scrollListing = (page: Page, to: number | "end") =>
  page
    .getByRole("table")
    .first()
    .evaluate((table, by) => {
      let scroller: Element = document.scrollingElement ?? document.documentElement;
      for (let node = table.parentElement; node !== null; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if (overflowY === "auto" || overflowY === "scroll") {
          scroller = node;
          break;
        }
      }
      scroller.scrollTop = by === "end" ? scroller.scrollHeight : scroller.scrollTop + by;
    }, to);

/** The rows the document holds, the header row among them. */
const rowCount = (page: Page) => page.getByRole("row").count();

for (const count of SIZES) {
  test.describe(`A folder of ${count.toLocaleString("en")} files`, () => {
    test(`shows its first rows within ${BUDGET_MS} ms of the listing`, async ({ page }) => {
      const answered = await openLarge(page, count);
      await shown(page.getByRole("link", { name: nameOf(1), exact: true }));
      expect(Date.now() - answered).toBeLessThan(BUDGET_MS);
    });

    test(`keeps fewer than ${MOST_ROWS} rows in the document`, async ({ page }) => {
      await openLarge(page, count);
      await shown(page.getByRole("link", { name: nameOf(1), exact: true }));
      expect(await rowCount(page)).toBeLessThan(MOST_ROWS);
      await scrollListing(page, 20_000);
      await expect.poll(() => listed(page)).not.toContain(nameOf(1));
      expect(await rowCount(page)).toBeLessThan(MOST_ROWS);
    });

    test("scrolls to its last file", async ({ page }) => {
      await openLarge(page, count);
      await shown(page.getByRole("link", { name: nameOf(1), exact: true }));
      const last = page.getByRole("link", { name: nameOf(count), exact: true });
      await expect(async () => {
        await scrollListing(page, "end");
        await expect(last).toBeInViewport({ timeout: 500 });
      }).toPass({ timeout: 20_000 });
    });

    test(`sorts by size, largest first, within ${BUDGET_MS} ms`, async ({ page }) => {
      await openLarge(page, count);
      await shown(page.getByRole("link", { name: nameOf(1), exact: true }));
      const size = page.getByRole("columnheader", { name: "Size" });
      await page.getByRole("button", { name: "Size" }).click();
      await expect(size).toHaveAttribute("aria-sort", "ascending");
      const started = Date.now();
      await page.getByRole("button", { name: "Size" }).click();
      await expect(size).toHaveAttribute("aria-sort", "descending");
      await expect.poll(async () => (await listed(page))[0]).toBe(nameOf(count));
      expect(Date.now() - started).toBeLessThan(BUDGET_MS);
    });

    test(`finds one file by its name within ${BUDGET_MS} ms`, async ({ page }) => {
      await openLarge(page, count);
      await shown(page.getByRole("link", { name: nameOf(1), exact: true }));
      const wanted = nameOf(Math.ceil(count / 2));
      const started = Date.now();
      await page.getByRole("searchbox", { name: "Search this folder" }).fill(wanted);
      await expect.poll(() => listed(page)).toEqual([wanted]);
      expect(Date.now() - started).toBeLessThan(BUDGET_MS);
    });
  });
}

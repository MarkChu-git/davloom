import { expect, test } from "@playwright/test";
import {
  PREVIEW,
  boxOf,
  installClock,
  levelOne,
  listed,
  onScreen,
  placeholderRows,
  shown,
  stopTimers,
} from "./helpers";

// The File Explorer's scenarios about finding things: the folder in the address, the loading and
// empty states, sorting, search, an item's details, long names and a backend that does not answer.
// The ones about changing content have their tests in file-explorer-changes.spec.ts.

const QUARTERLY_REPORT = "Quarterly report — Q3 2026, final version (signed by both parties).pdf";
const EXPORTED_LOG =
  "an-export-from-the-old-nas-with-a-very-long-file-name-that-keeps-going-2026-11-16.log";

/** What `/documents` holds, folders first. */
const DOCUMENTS_FOLDERS = ["Contracts", "Drafts", "Invoices 2026", "Scans"];

/** The files of `/documents`, smallest first. */
const DOCUMENTS_BY_SIZE = [
  "README.txt",
  "meeting-notes-2026-11-14.md",
  "budget-2027.xlsx",
  EXPORTED_LOG,
  QUARTERLY_REPORT,
];

test("Opening a folder by its address: the breadcrumb names the folder and the list shows what it holds", async ({
  page,
}) => {
  await page.goto("/files?path=%2Fdocuments");
  const breadcrumb = page.getByRole("navigation", { name: "Folder" });
  await expect(breadcrumb).toHaveText("Files / documents", { useInnerText: true });
  await expect.poll(() => listed(page)).toHaveLength(9);
  expect((await listed(page)).slice(0, 4)).toEqual(DOCUMENTS_FOLDERS);

  // Every folder above the one open is a link.
  const hrefs = () =>
    breadcrumb
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  await page.goto("/files?path=%2Fdocuments%2FDrafts");
  await expect(breadcrumb).toHaveText("Files / documents / Drafts", { useInnerText: true });
  await expect(breadcrumb.getByRole("link")).toHaveText(["Files", "documents"]);
  expect(await hrefs()).toEqual(["/files", "/files?path=%2Fdocuments"]);

  // The samples have no folder three levels down, so this one is made and opened from inside the
  // page, since a reload would bring the samples back.
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Nested");
  await page.getByRole("dialog").getByRole("button", { name: "Create folder" }).click();
  await page.getByRole("link", { name: "Nested", exact: true }).click();
  await expect(breadcrumb).toHaveText("Files / documents / Drafts / Nested", {
    useInnerText: true,
  });
  expect(await hrefs()).toEqual([
    "/files",
    "/files?path=%2Fdocuments",
    "/files?path=%2Fdocuments%2FDrafts",
  ]);
});

test("The top level: the mounts are the folders, Manage mounts replaces the buttons that change content, and no row can be selected", async ({
  page,
}) => {
  await page.goto("/files");
  await expect
    .poll(async () => (await listed(page)).toSorted())
    .toEqual(["archive", "documents", "photos", "shared"]);
  await shown(page.getByRole("link", { name: "Manage mounts" }));
  await expect(page.getByRole("button", { name: "New folder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("A folder that does not exist: the page says so and offers Go to Files, with no New folder or Upload", async ({
  page,
}) => {
  await page.goto("/files?path=%2Fdocuments%2Fmissing");
  await shown(page.getByRole("heading", { name: "This folder does not exist" }));
  await expect(page.getByRole("link", { name: "Go to Files" })).toHaveAttribute("href", "/files");
  await expect(page.getByRole("button", { name: "New folder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
});

test("A folder while it loads: placeholder rows show until the list replaces them", async ({
  page,
}) => {
  await installClock(page);
  await stopTimers(page);
  await page.goto("/files?path=%2Fdocuments");
  await expect(levelOne(page)).toHaveText("Files");
  await expect(placeholderRows(page)).toHaveCount(15);
  await expect(page.getByRole("row")).toHaveCount(0);

  // The listing arrives after a short pause, as it would while the API answers.
  await page.clock.runFor(400);
  await expect(placeholderRows(page)).toHaveCount(0);
  await expect.poll(() => listed(page)).toHaveLength(9);
});

test("An empty folder: a new folder says it is empty and offers New folder and Upload", async ({
  page,
}) => {
  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Receipts");
  await page.getByRole("dialog").getByRole("button", { name: "Create folder" }).click();
  await page.getByRole("link", { name: "Receipts", exact: true }).click();

  const empty = page.locator(".astryx-empty-state");
  await shown(empty.getByRole("heading", { name: "This folder is empty" }));
  await shown(empty.getByRole("button", { name: "New folder" }));
  await shown(empty.getByRole("button", { name: "Upload" }));
});

test("Sorting by size: both ways, every folder comes before every file and the files are in size order", async ({
  page,
}) => {
  await page.goto("/files?path=%2Fdocuments");
  const size = page.getByRole("columnheader", { name: "Size" });
  const inOrder = async (files: string[]) => {
    await expect.poll(async () => (await listed(page)).slice(4)).toEqual(files);
    expect((await listed(page)).slice(0, 4).toSorted()).toEqual(DOCUMENTS_FOLDERS.toSorted());
  };

  await page.getByRole("button", { name: "Size" }).click();
  await expect(size).toHaveAttribute("aria-sort", "ascending");
  await inOrder(DOCUMENTS_BY_SIZE);

  await page.getByRole("button", { name: "Size" }).click();
  await expect(size).toHaveAttribute("aria-sort", "descending");
  await inOrder(DOCUMENTS_BY_SIZE.toReversed());
});

test("Matching names: REPORT leaves the quarterly report, and a polite announcement says 1 item matches", async ({
  page,
}) => {
  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("searchbox", { name: "Search this folder" }).fill("REPORT");
  await expect.poll(() => listed(page)).toEqual([QUARTERLY_REPORT]);
  await expect(page.locator('[data-astryx-live-region="polite"]')).toHaveText("1 item matches");
});

test("No match: the page says nothing matches and clearing the search brings the list back", async ({
  page,
}) => {
  await page.goto("/files?path=%2Fdocuments");
  const search = page.getByRole("searchbox", { name: "Search this folder" });
  await search.fill("zzz");
  await shown(page.getByRole("heading", { name: "Nothing here matches “zzz”" }));
  await expect.poll(() => listed(page)).toEqual([]);

  await page.locator(".astryx-empty-state").getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect.poll(() => listed(page)).toHaveLength(9);
});

test("Details beside the list: a panel gives the size as 120 bytes and previews the file's text", async ({
  page,
}) => {
  await page.goto(PREVIEW);
  const details = page.locator('[aria-label="Details"]');
  await expect(details).toContainText(/Size\s+120 bytes/, { useInnerText: true });
  await expect(details).toContainText("Network: guest");
  await expect(details).toContainText("Password: on the fridge");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Beside the list, not under it.
  const list = await boxOf(page.getByRole("table"));
  const panel = await boxOf(details);
  expect(panel.x).toBeGreaterThanOrEqual(list.x + list.width - 1);
});

test("Details in a dialog: a narrow window opens them in a dialog named after the file, and closing it clears the address", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(PREVIEW);
  const dialog = page.getByRole("dialog", { name: "wifi-guest.txt" });
  await shown(dialog.getByRole("heading", { name: "Preview" }));
  expect(new URL(page.url()).searchParams.get("file")).toBe("wifi-guest.txt");

  await dialog.getByRole("button", { name: /^Close/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("file")).toBeNull();
});

test("A long log file name: the stem ends in an ellipsis and .log stays whole beside it", async ({
  page,
}) => {
  // At 1280 px the name fills its column only where the machine's font is wide, since Davloom
  // loads none, so 1024 px makes the name too long on every machine.
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/files?path=%2Fdocuments");
    const name = await page
      .getByRole("link", { name: EXPORTED_LOG, exact: true })
      .evaluate((link, whole) => {
        const stem = whole.slice(0, -".log".length);
        const leaves = [...link.querySelectorAll("span")].filter(
          (span) => span.children.length === 0,
        );
        const parts = [stem, ".log"].map((text) =>
          leaves.find((span) => span.textContent === text),
        );
        const [start, end] = parts;
        if (start === undefined || end === undefined) {
          return undefined;
        }
        const style = getComputedStyle(start);
        const stemBox = start.getBoundingClientRect();
        const endBox = end.getBoundingClientRect();
        return {
          isCut: start.scrollWidth > start.clientWidth,
          hasEllipsis: style.textOverflow === "ellipsis" && style.overflow === "hidden",
          gap: endBox.left - stemBox.right,
          overhang: endBox.right - (link.closest("td")?.getBoundingClientRect().right ?? 0),
        };
      }, EXPORTED_LOG);
    expect(name, `the stem and the extension at ${width} px`).toBeDefined();
    expect.soft(name?.hasEllipsis, `an ellipsis at ${width} px`).toBe(true);
    // The extension follows the stem directly and ends inside the cell.
    expect.soft(name?.gap, `the extension against the stem at ${width} px`).toBeLessThan(2);
    expect
      .soft(name?.overhang, `the extension inside the cell at ${width} px`)
      .toBeLessThanOrEqual(0);
    if (width === 1024) {
      expect.soft(name?.isCut, `the stem cut at ${width} px`).toBe(true);
    }
  }
});

test("Opening the archive: an error says RustFS archive gave no answer and offers Try again, and the buttons that change content say why they are off", async ({
  page,
}) => {
  await page.goto("/files?path=%2Farchive");
  await shown(onScreen(page, "Cannot list /archive"));
  await shown(onScreen(page, "RustFS archive gave no answer within 30 s."));
  await shown(page.getByRole("button", { name: "Try again" }));
  // The folder is not shown as an empty one.
  await expect(page.getByRole("heading", { name: "This folder is empty" })).toHaveCount(0);
  await expect(page.getByRole("row")).toHaveCount(0);

  for (const name of ["New folder", "Upload"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeDisabled();
    await button.hover();
    await expect(page.getByRole("tooltip")).toHaveText("RustFS archive is not answering.");
  }
});

test("Trying again: the button shows it is working and keeps focus, then an assertive announcement says the folder still cannot be listed", async ({
  page,
}) => {
  await installClock(page);
  await stopTimers(page);
  await page.goto("/files?path=%2Farchive");
  // The page is waiting for its listing, whose timer the clock runs.
  await expect(placeholderRows(page)).toHaveCount(15);
  await page.clock.runFor(400);
  const again = page.getByRole("button", { name: "Try again" });

  await again.click();
  await expect(again).toHaveAttribute("aria-busy", "true");
  await expect(again).toBeFocused();

  // The try ends after a short pause, as it would while the API answers.
  await page.clock.runFor(1000);
  await expect(again).not.toHaveAttribute("aria-busy", "true");
  await expect(again).toBeFocused();
  await expect(page.locator('[data-astryx-live-region="assertive"]')).toHaveText(
    "Still cannot list /archive. RustFS archive gave no answer within 30 s.",
  );
});

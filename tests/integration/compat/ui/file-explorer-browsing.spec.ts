import { expect, test, type Page } from "@playwright/test";
import {
  PREVIEW,
  boxOf,
  filesAt,
  isNarrow,
  levelOne,
  listed,
  onScreen,
  placeholderRows,
  shown,
} from "./helpers";
import { createMount, dav, LONG_LOG_NAME, scratchFolder, SAMPLE_NAMES, unique } from "./instances";

// The File Explorer's scenarios about finding things: the folder in the address, the loading and
// empty states, sorting, search, an item's details, long names and a listing that fails. Each test
// lists a folder of its own in the Mount "files", which holds the sample (instances.ts). The ones
// about changing content have their tests in file-explorer-changes.spec.ts. A narrow page, as on
// a tablet or a phone, sorts with a menu in the Name header's place and opens a file's details in a
// dialog, and the tests that run at every size take either way.

const QUARTERLY_REPORT = "Quarterly report — Q3 2026, final version (signed by both parties).pdf";

/** The sample's folders, which come before its files. */
const FOLDERS = SAMPLE_NAMES.slice(0, 4);

/** The sample's files, smallest first. */
const FILES_BY_SIZE = [
  "meeting-notes-2026-11-14.md",
  "README.txt",
  "wifi-guest.txt",
  LONG_LOG_NAME,
  QUARTERLY_REPORT,
  "budget-2027.xlsx",
];

/** The last name of a folder's path. */
const nameOf = (folder: string): string => folder.split("/").at(-1) ?? "";

/** Holds every listing back until the returned function lets it go. */
const holdListings = async (page: Page) => {
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  await page.route("**/dav/**", async (route) => {
    if (route.request().method() === "PROPFIND") {
      await released;
    }
    await route.continue();
  });
  return release;
};

test("Opening a folder by its address: the breadcrumb names the folder and the list shows what it holds", async ({
  page,
}) => {
  const folder = await scratchFolder(page.request);
  await page.goto(filesAt(folder));
  const breadcrumb = page.getByRole("navigation", { name: "Folder" });
  await expect(breadcrumb).toHaveText(`Files / files / ${nameOf(folder)}`, { useInnerText: true });
  await expect.poll(() => listed(page)).toEqual(SAMPLE_NAMES);

  // Every folder above the one open is a link.
  const hrefs = () =>
    breadcrumb
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  await page.goto(filesAt(`${folder}/Drafts`));
  await expect(breadcrumb.getByRole("link")).toHaveText(["Files", "files", nameOf(folder)]);
  expect(await hrefs()).toEqual(["/files", filesAt("/files"), filesAt(folder)]);
  await expect.poll(() => listed(page)).toEqual(["blog-post-self-hosting.md"]);
});

test("The top level: the mounts are the folders, Manage mounts replaces the buttons that change content, and no row can be selected", async ({
  page,
}) => {
  const name = unique("photos");
  await createMount(page.request, name);
  await page.goto("/files");
  // A folder's row links to the folder.
  await shown(page.getByRole("row").getByRole("link", { name: "files", exact: true }));
  await expect(page.getByRole("row").getByRole("link", { name, exact: true })).toHaveAttribute(
    "href",
    filesAt(`/${name}`),
  );
  await shown(page.getByRole("link", { name: "Manage mounts" }));
  await expect(page.getByRole("button", { name: "New folder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("A folder that does not exist: the page says so and offers Go to Files, with no New folder or Upload", async ({
  page,
}) => {
  for (const path of ["/files/missing-folder", "/no-such-mount/a"]) {
    await page.goto(filesAt(path));
    await shown(page.getByRole("heading", { name: "This folder does not exist" }));
    await expect(page.getByRole("link", { name: "Go to Files" })).toHaveAttribute("href", "/files");
    await expect(page.getByRole("button", { name: "New folder" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
  }
});

test("A folder while it loads: placeholder rows show until the list replaces them", async ({
  page,
}) => {
  const folder = await scratchFolder(page.request);
  const release = await holdListings(page);
  await page.goto(filesAt(folder));
  await expect(levelOne(page)).toHaveText("Files");
  await expect(placeholderRows(page)).toHaveCount(15);
  await expect(page.getByRole("row")).toHaveCount(0);

  release();
  await expect(placeholderRows(page)).toHaveCount(0);
  await expect.poll(() => listed(page)).toHaveLength(SAMPLE_NAMES.length);
});

test("An empty folder: it says it is empty and offers New folder and Upload", async ({ page }) => {
  const folder = await scratchFolder(page.request, { withSample: false });
  await page.goto(filesAt(folder));
  const empty = page.locator(".astryx-empty-state");
  await shown(empty.getByRole("heading", { name: "This folder is empty" }));
  await shown(empty.getByRole("button", { name: "New folder" }));
  await shown(empty.getByRole("button", { name: "Upload" }));
});

test("Sorting by size: both ways, every folder comes before every file and the files are in size order", async ({
  page,
}) => {
  const folder = await scratchFolder(page.request);
  await page.goto(filesAt(folder));
  const size = page.getByRole("columnheader", { name: "Size" });
  const inOrder = async (files: string[]) => {
    await expect.poll(async () => (await listed(page)).slice(4)).toEqual(files);
    expect((await listed(page)).slice(0, 4).toSorted()).toEqual(FOLDERS.toSorted());
  };

  if (isNarrow(page)) {
    // Without a Size column, the menu in the Name header's place sorts, and its button names the
    // order in use.
    const sortMenu = (named: string) =>
      page.getByRole("columnheader", { name: named }).getByRole("button", { name: named });
    await sortMenu("Name, A to Z").click();
    await page.getByRole("menuitemradio", { name: "Size" }).click();
    await shown(sortMenu("Size, smallest first"));
    await inOrder(FILES_BY_SIZE);

    await sortMenu("Size, smallest first").click();
    await page.getByRole("menuitemradio", { name: "Largest first" }).click();
    await shown(sortMenu("Size, largest first"));
    await inOrder(FILES_BY_SIZE.toReversed());
    return;
  }
  await page.getByRole("button", { name: "Size" }).click();
  await expect(size).toHaveAttribute("aria-sort", "ascending");
  await inOrder(FILES_BY_SIZE);

  await page.getByRole("button", { name: "Size" }).click();
  await expect(size).toHaveAttribute("aria-sort", "descending");
  await inOrder(FILES_BY_SIZE.toReversed());
});

test("Matching names: REPORT leaves the quarterly report, and a polite announcement says 1 item matches", async ({
  page,
}) => {
  const folder = await scratchFolder(page.request);
  await page.goto(filesAt(folder));
  await expect.poll(() => listed(page)).toHaveLength(SAMPLE_NAMES.length);
  await page.getByRole("searchbox", { name: "Search this folder" }).fill("REPORT");
  // The announcement clears after a while, so it is read before the list.
  await expect(page.locator('[data-astryx-live-region="polite"]')).toHaveText("1 item matches");
  await expect.poll(() => listed(page)).toEqual([QUARTERLY_REPORT]);
});

test("No match: the page says nothing matches and clearing the search brings the list back", async ({
  page,
}) => {
  const folder = await scratchFolder(page.request);
  await page.goto(filesAt(folder));
  const search = page.getByRole("searchbox", { name: "Search this folder" });
  await expect.poll(() => listed(page)).toHaveLength(SAMPLE_NAMES.length);
  await search.fill("zzz");
  await shown(page.getByRole("heading", { name: "Nothing here matches “zzz”" }));
  await expect.poll(() => listed(page)).toEqual([]);

  await page.locator(".astryx-empty-state").getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect.poll(() => listed(page)).toHaveLength(SAMPLE_NAMES.length);
});

// It sets a window of its own, so the tablet and phone projects skip it.
test(
  "Details beside the list: a panel gives the size as 120 bytes, the backend, and previews the file's text",
  { tag: "@desktop" },
  async ({ page }) => {
    const folder = await scratchFolder(page.request);
    await dav(page.request, "PUT", `${folder}/guest.txt`, {
      body: "Network: guest\nPassword: on the fridge\n".padEnd(120, " "),
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(filesAt(folder, "guest.txt"));
    const details = page.locator('[aria-label="Details"]');
    await expect(details).toContainText(/Size\s+120 bytes/, { useInnerText: true });
    await expect(details).toContainText(/Stored on\s+Default/, { useInnerText: true });
    await expect(details).toContainText("Network: guest");
    await expect(details).toContainText("Password: on the fridge");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Beside the list, not under it.
    const list = await boxOf(page.getByRole("table"));
    const panel = await boxOf(details);
    expect(panel.x).toBeGreaterThanOrEqual(list.x + list.width - 1);
  },
);

test("A file without a preview: a spreadsheet's details say there is no preview", async ({
  page,
}) => {
  const folder = await scratchFolder(page.request);
  // A narrow page shows the details in a dialog named after the file.
  if (!isNarrow(page)) {
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await page.goto(filesAt(folder, "budget-2027.xlsx"));
  const details = isNarrow(page)
    ? page.getByRole("dialog", { name: "budget-2027.xlsx" })
    : page.locator('[aria-label="Details"]');
  await expect(details).toContainText(/Size\s+48.2 kB/, { useInnerText: true });
  await expect(details).toContainText("No preview for this kind of file.");
});

test("Details in a dialog: a narrow window opens them in a dialog named after the file, and closing it clears the address", async ({
  page,
}) => {
  // A tablet's or a phone's window is narrow already.
  if (!isNarrow(page)) {
    await page.setViewportSize({ width: 375, height: 800 });
  }
  await page.goto(PREVIEW);
  const dialog = page.getByRole("dialog", { name: "wifi-guest.txt" });
  await shown(dialog.getByRole("heading", { name: "Preview" }));
  expect(new URL(page.url()).searchParams.get("file")).toBe("wifi-guest.txt");

  await dialog.getByRole("button", { name: /^Close/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("file")).toBeNull();
});

// It sets the windows it measures, so the tablet and phone projects skip it.
test(
  "A long log file name: the stem ends in an ellipsis and .log stays whole beside it",
  { tag: "@desktop" },
  async ({ page }) => {
    const folder = await scratchFolder(page.request);
    // At 1280 px the name fills its column only where the machine's font is wide, since Davloom
    // loads none, so 1024 px makes the name too long on every machine.
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(filesAt(folder));
      const name = await page
        .getByRole("link", { name: LONG_LOG_NAME, exact: true })
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
            extensionWidth: endBox.width,
            overhang: endBox.right - (link.closest("td")?.getBoundingClientRect().right ?? 0),
          };
        }, LONG_LOG_NAME);
      expect(name, `the stem and the extension at ${width} px`).toBeDefined();
      expect.soft(name?.hasEllipsis, `an ellipsis at ${width} px`).toBe(true);
      // The extension is on screen, follows the stem directly and ends inside the cell.
      expect.soft(name?.extensionWidth, `the extension's width at ${width} px`).toBeGreaterThan(0);
      expect.soft(name?.gap, `the extension against the stem at ${width} px`).toBeGreaterThan(-1);
      expect.soft(name?.gap, `the extension against the stem at ${width} px`).toBeLessThan(2);
      expect
        .soft(name?.overhang, `the extension inside the cell at ${width} px`)
        .toBeLessThanOrEqual(0);
      if (width === 1024) {
        expect.soft(name?.isCut, `the stem cut at ${width} px`).toBe(true);
      }
    }
  },
);

test("A listing that fails: an error says the backend is not answering, announces it, and offers Try again, with no buttons that change content", async ({
  page,
}) => {
  const folder = await scratchFolder(page.request);
  let refuse = true;
  await page.route("**/dav/**", (route) =>
    refuse && route.request().method() === "PROPFIND"
      ? route.fulfill({ status: 503, body: "" })
      : route.continue(),
  );
  await page.goto(filesAt(folder));
  await shown(onScreen(page, `Cannot list ${folder}`));
  await shown(onScreen(page, "The storage backend is not answering."));
  await expect(page.locator('[data-astryx-live-region="assertive"]')).toHaveText(
    `Cannot list ${folder}. The storage backend is not answering.`,
  );
  // The folder is not shown as an empty one, and nothing in it can change.
  await expect(page.getByRole("heading", { name: "This folder is empty" })).toHaveCount(0);
  await expect(page.getByRole("row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New folder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);

  refuse = false;
  const again = page.getByRole("button", { name: "Try again" });
  await again.click();
  await expect.poll(() => listed(page)).toEqual(SAMPLE_NAMES);
});

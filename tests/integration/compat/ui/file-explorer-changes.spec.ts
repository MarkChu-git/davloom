import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { test } from "./fixtures";
import { boxOf, cardWith, filesAt, listed, onlyInChromium, onScreen, shown } from "./helpers";
import { dav, davPath, README, SAMPLE_NAMES, scratchFolder } from "./instances";

// The File Explorer's scenarios about changing content on the Worker: names, moving and copying,
// deleting, uploading and downloading. Each test changes a folder of its own in the Mount "files",
// which holds the sample (instances.ts). The ones about finding things have their tests in
// file-explorer-browsing.spec.ts.

/** A text file on disk for a test to upload. */
const textFile = (testInfo: TestInfo, name: string, text: string): string => {
  const path = testInfo.outputPath(name);
  writeFileSync(path, text);
  return path;
};

/** A file of this many bytes on disk, sparse so that a large one costs nothing to make. */
const sparseFile = (testInfo: TestInfo, name: string, bytes: number): string => {
  const path = testInfo.outputPath(name);
  const file = openSync(path, "w");
  try {
    ftruncateSync(file, bytes);
  } finally {
    closeSync(file);
  }
  return path;
};

/** Opens a folder of the test's own, with the sample in it. */
const openScratch = async (page: Page): Promise<string> => {
  const folder = await scratchFolder(page.request);
  await page.goto(filesAt(folder));
  await expect.poll(() => listed(page)).toHaveLength(SAMPLE_NAMES.length);
  return folder;
};

/** Opens the upload area of a folder of the test's own and hands it files, as choosing them does. */
const uploadFiles = async (page: Page, files: string | string[]): Promise<string> => {
  const folder = await openScratch(page);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(files);
  return folder;
};

/** The card with the upload area and the progress of every file. */
const uploadPanel = (page: Page) =>
  cardWith(page, page.getByRole("heading", { name: "Upload", exact: true }));

/** What the server holds at a path, as text. */
const stored = async (page: Page, path: string): Promise<string> =>
  (await dav(page.request, "GET", path)).text();

test("A new folder: it is made on the server, and the list shows it", async ({ page }) => {
  const folder = await openScratch(page);
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Receipts 2026");
  await page.getByRole("dialog").getByRole("button", { name: "Create folder" }).click();
  await shown(onScreen(page, "Created “Receipts 2026”."));
  await page.getByRole("link", { name: "Receipts 2026", exact: true }).click();
  await shown(page.getByRole("heading", { name: "This folder is empty" }));
  expect(
    (
      await dav(page.request, "PROPFIND", `${folder}/Receipts 2026`, {
        isFolder: true,
        headers: { depth: "0" },
      })
    ).status(),
  ).toBe(207);
});

test("A name already in use: New folder shows no error until Drafts is submitted, then stays open and says so", async ({
  page,
}) => {
  const taken = "Something with this name is already here.";
  await openScratch(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog");
  const name = dialog.getByLabel("Name");
  await shown(name);
  // No error shows before the submit, whatever the field holds.
  await expect(name).not.toHaveAttribute("aria-invalid", "true");
  await expect(onScreen(page, taken)).toHaveCount(0);

  await name.fill("Drafts");
  await expect(name).not.toHaveAttribute("aria-invalid", "true");
  await expect(onScreen(page, taken)).toHaveCount(0);

  await dialog.getByRole("button", { name: "Create folder" }).click();
  // The dialog stays open and says so on screen, in the field that holds the name.
  await shown(onScreen(page, taken));
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription(taken);
  await expect(dialog).toBeVisible();
});

test("Renaming a file: MOVE gives it the new name, and its details follow it", async ({ page }) => {
  const folder = await openScratch(page);
  await page.getByRole("button", { name: "Actions for README.txt" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("READ ME first.txt");
  await dialog.getByRole("button", { name: "Rename" }).click();

  await shown(onScreen(page, "Renamed to “READ ME first.txt”."));
  await shown(page.getByRole("link", { name: "READ ME first.txt", exact: true }));
  await expect(page.getByRole("link", { name: "README.txt", exact: true })).toHaveCount(0);
  expect(await stored(page, `${folder}/READ ME first.txt`)).toBe(README);
});

test("Moving into the folder itself: Move refuses Drafts into Drafts, and moves README.txt there", async ({
  page,
}) => {
  const folder = await openScratch(page);
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Actions for Drafts" }).click();
  await page.getByRole("menuitem", { name: "Move" }).click();
  const destination = dialog.getByLabel("Destination folder");
  // The form starts from the folder that is open.
  await expect(destination).toHaveValue(folder);
  await destination.fill(`${folder}/Drafts/Old`);
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await shown(onScreen(page, "A folder cannot go inside itself."));
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Actions for README.txt" }).click();
  await page.getByRole("menuitem", { name: "Move" }).click();
  await destination.fill(`${folder}/Drafts`);
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await shown(onScreen(page, `Moved “README.txt” to ${folder}/Drafts.`));
  await expect(page.getByRole("link", { name: "README.txt", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Drafts", exact: true }).click();
  await expect.poll(() => listed(page)).toEqual(["blog-post-self-hosting.md", "README.txt"]);
});

test("A name already at the destination: copying README.txt into Drafts a second time is refused and copies nothing", async ({
  page,
}) => {
  const folder = await openScratch(page);
  const dialog = page.getByRole("dialog");
  const copyReadmeToDrafts = async () => {
    await page.getByRole("button", { name: "Actions for README.txt" }).click();
    await page.getByRole("menuitem", { name: "Copy" }).click();
    await dialog.getByLabel("Destination folder").fill(`${folder}/Drafts`);
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  };

  await copyReadmeToDrafts();
  await shown(onScreen(page, `Copied “README.txt” to ${folder}/Drafts.`));
  await expect(dialog).toHaveCount(0);

  await copyReadmeToDrafts();
  const taken = `Something named “README.txt” is already in ${folder}/Drafts.`;
  await shown(onScreen(page, taken));
  await expect(dialog).toBeVisible();
  // The dialog says it, at the destination it refused.
  await expect(dialog.getByLabel("Destination folder")).toHaveAccessibleDescription(
    `A folder's path, starting with its mount, such as /files/Archive. ${taken}`,
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("link", { name: "Drafts", exact: true }).click();
  await expect.poll(() => listed(page)).toEqual(["blog-post-self-hosting.md", "README.txt"]);
});

test("A destination that does not exist: the copy is refused and says so", async ({ page }) => {
  const folder = await openScratch(page);
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Actions for README.txt" }).click();
  await page.getByRole("menuitem", { name: "Copy" }).click();
  await dialog.getByLabel("Destination folder").fill(`${folder}/Nowhere`);
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await shown(onScreen(page, "The destination folder does not exist."));
});

test("Deleting two files: the confirmation names 2 items and says it cannot be undone, both files go, and a notification reports it", async ({
  page,
}) => {
  const folder = await openScratch(page);
  await page.getByRole("checkbox", { name: "Select budget-2027.xlsx" }).check();
  await page.getByRole("checkbox", { name: "Select README.txt" }).check();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Delete 2 items?");
  await expect(confirmation).toContainText("This cannot be undone.");
  await confirmation.getByRole("button", { name: "Delete" }).click();

  await expect(confirmation).toHaveCount(0);
  await shown(onScreen(page, "Deleted 2 items."));
  await expect.poll(() => listed(page)).toHaveLength(SAMPLE_NAMES.length - 2);
  const left = await listed(page);
  expect(left).not.toContain("budget-2027.xlsx");
  expect(left).not.toContain("README.txt");
  const gone = await page.request.fetch(davPath(`${folder}/README.txt`), {
    method: "HEAD",
    headers: { "x-davloom-dashboard": "1" },
  });
  expect(gone.status()).toBe(404);
});

test("One file too large: the 2 KB file is stored with a preview, the 150 MB file is refused for its size, and a notification says 1 of 2 uploads failed", async ({
  page,
}, testInfo) => {
  const notes = textFile(testInfo, "notes.txt", "Receipts for the accountant.\n".repeat(70));
  await uploadFiles(page, [notes, sparseFile(testInfo, "huge.bin", 150_000_000)]);

  await shown(onScreen(page, "1 of 2 uploads failed."));
  await shown(
    uploadPanel(page).getByText("Over the 100 MB limit for one request on Cloudflare Free."),
  );
  // The listing has rendered once notes.txt is in it, and only then can huge.bin be missing.
  const link = page.getByRole("link", { name: "notes.txt", exact: true });
  await shown(link);
  await expect(page.getByRole("link", { name: "huge.bin", exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 900 });
  await link.click();
  const details = page.locator('[aria-label="Details"]');
  await expect(details).toContainText(/Size\s+2 kB/, { useInnerText: true });
  await expect(details).toContainText("Receipts for the accountant.");
});

test("Uploading a file again: the uploaded README.txt replaces the old one on the server", async ({
  page,
}, testInfo) => {
  const folder = await uploadFiles(
    page,
    textFile(testInfo, "README.txt", "Replaced by an upload."),
  );

  await shown(onScreen(page, `Uploaded 1 file to ${folder}.`));
  await expect(page.getByRole("link", { name: "README.txt", exact: true })).toHaveCount(1);
  expect(await stored(page, `${folder}/README.txt`)).toBe("Replaced by an upload.");
});

test("A file with a folder's name: the upload fails because a folder has the name, and the folder is unchanged", async ({
  page,
}, testInfo) => {
  await uploadFiles(page, textFile(testInfo, "Drafts", "Not a folder."));

  await shown(uploadPanel(page).getByText("A folder named “Drafts” is already here."));
  await shown(onScreen(page, "1 of 1 upload failed."));
  // Drafts is still a folder, with what it held.
  await page.getByRole("link", { name: "Drafts", exact: true }).click();
  await expect.poll(() => listed(page)).toEqual(["blog-post-self-hosting.md"]);
});

test("A dropped folder: its upload fails and says to upload the files inside it", async ({
  page,
}, testInfo) => {
  onlyInChromium("It drives the browser through the Chrome DevTools Protocol.");
  // Playwright cannot drop a real folder, so the drop goes through the Chrome DevTools Protocol.
  const folder = testInfo.outputPath("Album");
  mkdirSync(folder);
  await openScratch(page);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const target = page.getByText("Drop files here or choose them");
  await shown(target);
  const box = await boxOf(target);
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const session = await page.context().newCDPSession(page);
  const data = { items: [], files: [folder], dragOperationsMask: 1 };
  for (const type of ["dragEnter", "dragOver", "drop"] as const) {
    await session.send("Input.dispatchDragEvent", { type, ...at, data });
  }

  await shown(
    uploadPanel(page).getByText(
      "This is a folder or a file that cannot be read. Upload the files inside a folder.",
    ),
  );
  await shown(onScreen(page, "1 of 1 upload failed."));
});

test("Downloading from a row: a notification says README.txt is downloading, and the browser saves its bytes", async ({
  page,
}, testInfo) => {
  await openScratch(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Actions for README.txt" }).click();
  await page.getByRole("menuitem", { name: "Download" }).click();

  await shown(onScreen(page, "Downloading “README.txt”."));
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("README.txt");
  const path = testInfo.outputPath("downloaded.txt");
  await saved.saveAs(path);
  expect(readFileSync(path, "utf8")).toBe(README);
});

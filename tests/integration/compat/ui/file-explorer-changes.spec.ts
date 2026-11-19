import { closeSync, ftruncateSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { cardWith, listed, onScreen, openList, shown } from "./helpers";

// The File Explorer's scenarios about changing content: names, moving and copying, deleting,
// uploading and downloading. The ones about finding things have their tests in
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
  ftruncateSync(file, bytes);
  closeSync(file);
  return path;
};

/** Opens the upload area of `/documents` and hands it files, as choosing them does. */
const uploadFiles = async (page: Page, files: string | string[]) => {
  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(files);
};

/** The card with the upload area and the progress of every file. */
const uploadPanel = (page: Page) =>
  cardWith(page, page.getByRole("heading", { name: "Upload", exact: true }));

test("A name already in use: New folder shows no error until Drafts is submitted, then stays open and says so", async ({
  page,
}) => {
  const taken = "Something with this name is already here.";
  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog");
  await expect(onScreen(page, taken)).toHaveCount(0);

  await dialog.getByLabel("Name").fill("Drafts");
  await expect(onScreen(page, taken)).toHaveCount(0);

  await dialog.getByRole("button", { name: "Create folder" }).click();
  await shown(onScreen(page, taken));
  await expect(dialog).toBeVisible();
});

test("Destinations for a folder: Move offers the folders of the mounts that answer, but not the folder, the one that holds it or what it holds", async ({
  page,
}) => {
  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("button", { name: "Actions for Drafts" }).click();
  await page.getByRole("menuitem", { name: "Move" }).click();
  await openList(page, "button", /^Destination/);

  await expect(page.getByRole("option")).toHaveText([
    "/documents/Contracts",
    "/documents/Invoices 2026",
    "/documents/Scans",
    "/shared",
    "/shared/Family",
    "/photos",
    "/photos/2025",
    "/photos/2026",
  ]);
});

test("A name already at the destination: copying README.txt into Drafts a second time is refused and copies nothing", async ({
  page,
}) => {
  await page.goto("/files?path=%2Fdocuments");
  const dialog = page.getByRole("dialog");
  const copyReadmeToDrafts = async () => {
    await page.getByRole("button", { name: "Actions for README.txt" }).click();
    await page.getByRole("menuitem", { name: "Copy" }).click();
    await openList(page, "button", /^Destination/);
    await page.getByRole("option", { name: "/documents/Drafts" }).click();
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  };

  await copyReadmeToDrafts();
  await shown(onScreen(page, "Copied “README.txt” to /documents/Drafts."));
  await expect(dialog).toHaveCount(0);

  await copyReadmeToDrafts();
  await shown(onScreen(page, "“README.txt” is already in /documents/Drafts."));
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The listing is reached from inside the page, since a reload would bring the samples back.
  await page.getByRole("link", { name: "Drafts", exact: true }).click();
  await expect.poll(() => listed(page)).toEqual(["blog-post-self-hosting.md", "README.txt"]);
});

test("Deleting two files: the confirmation names 2 items and says it cannot be undone, both files go, and a notification reports it", async ({
  page,
}) => {
  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("checkbox", { name: "Select budget-2027.xlsx" }).check();
  await page.getByRole("checkbox", { name: "Select README.txt" }).check();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Delete 2 items?");
  await expect(confirmation).toContainText("This cannot be undone.");
  await confirmation.getByRole("button", { name: "Delete" }).click();

  await expect(confirmation).toHaveCount(0);
  await shown(onScreen(page, "Deleted 2 items."));
  const left = await listed(page);
  expect(left).toHaveLength(7);
  expect(left).not.toContain("budget-2027.xlsx");
  expect(left).not.toContain("README.txt");
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
  await expect(page.getByRole("link", { name: "huge.bin", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "notes.txt", exact: true }).click();
  const details = page.locator('[aria-label="Details"]');
  await expect(details).toContainText(/Size\s+2 kB/, { useInnerText: true });
  await expect(details).toContainText("Receipts for the accountant.");
});

test("Uploading a file again: the uploaded README.txt replaces the old one", async ({
  page,
}, testInfo) => {
  await uploadFiles(page, textFile(testInfo, "README.txt", "Replaced by an upload."));

  await shown(onScreen(page, "Uploaded 1 file to /documents."));
  const readme = page.getByRole("link", { name: "README.txt", exact: true });
  await expect(readme).toHaveCount(1);
  await readme.click();
  const details = page.locator('[aria-label="Details"]');
  await expect(details).toContainText("Replaced by an upload.");
  await expect(details).not.toContainText("syncs to the laptop");
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
  // Playwright cannot drop a real folder, so the drop goes through the Chrome DevTools Protocol.
  const folder = testInfo.outputPath("Album");
  mkdirSync(folder);
  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const target = page.getByText("Drop files here or choose them");
  await shown(target);
  const box = await target.boundingBox();
  const at = {
    x: (box?.x ?? Number.NaN) + (box?.width ?? 0) / 2,
    y: (box?.y ?? Number.NaN) + (box?.height ?? 0) / 2,
  };
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

test("Downloading from a row: a notification says README.txt is downloading", async ({ page }) => {
  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("button", { name: "Actions for README.txt" }).click();
  await page.getByRole("menuitem", { name: "Download" }).click();

  await shown(onScreen(page, "Downloading “README.txt”."));
});

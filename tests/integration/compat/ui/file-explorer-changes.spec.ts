import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
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

/** The dialog that moves or copies, opened from an item's Actions menu. */
const openTransfer = async (page: Page, name: string, verb: "Move" | "Copy") => {
  await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: verb, exact: true }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: `${verb} “${name}”`, exact: true }) });
  await shown(dialog);
  return dialog;
};

/** The folder the destination picker shows, read from its path. */
const destinationOf = (dialog: Locator) => dialog.getByRole("navigation", { name: "Destination" });

/** A folder the destination picker lists, which opens it. */
const pickerFolder = (dialog: Locator, name: string) =>
  dialog.getByRole("button", { name, exact: true });

test("Moving into the folder itself: the picker starts where the items are, keeps Drafts from being opened when Drafts moves, and moves README.txt into Drafts", async ({
  page,
}) => {
  const folder = await openScratch(page);
  const scratch = folder.split("/").at(-1) ?? "";
  let dialog = await openTransfer(page, "Drafts", "Move");
  // The picker starts from the folder that is open, and lists the folders inside it.
  await expect(destinationOf(dialog)).toContainText(scratch);
  await shown(pickerFolder(dialog, "Contracts"));
  // Drafts is what moves, so it cannot be opened as the destination.
  await expect(pickerFolder(dialog, "Drafts")).toHaveAttribute("aria-disabled", "true");
  await expect(pickerFolder(dialog, "Contracts")).not.toHaveAttribute("aria-disabled", "true");
  // Where the items already are is no destination either.
  await dialog.getByRole("button", { name: "Move here" }).click();
  await shown(dialog.getByText("Choose another folder than the one they are in."));
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  dialog = await openTransfer(page, "README.txt", "Move");
  await pickerFolder(dialog, "Drafts").click();
  await expect(destinationOf(dialog)).toContainText("Drafts");
  await dialog.getByRole("button", { name: "Move here" }).click();
  await shown(onScreen(page, `Moved “README.txt” to ${folder}/Drafts.`));
  await expect(page.getByRole("link", { name: "README.txt", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Drafts", exact: true }).click();
  await expect.poll(() => listed(page)).toEqual(["blog-post-self-hosting.md", "README.txt"]);
  expect(await stored(page, `${folder}/Drafts/README.txt`)).toBe(README);
});

test("Browsing for a destination: the path leads back up to Files, which lists the mounts", async ({
  page,
}) => {
  await openScratch(page);
  const dialog = await openTransfer(page, "README.txt", "Copy");
  await pickerFolder(dialog, "Drafts").click();
  await shown(dialog.getByText("No folders inside"));
  await destinationOf(dialog).getByText("Files", { exact: true }).click();
  // The top of Files lists the mounts that can take the items.
  await shown(pickerFolder(dialog, "files"));
  await expect(dialog.getByRole("button", { name: "Copy here" })).toBeVisible();
  await dialog.getByRole("button", { name: "Copy here" }).click();
  await shown(dialog.getByText("Choose a folder inside a mount, such as /files."));
  await expect(dialog).toBeVisible();
});

test("A name already at the destination: copying README.txt into Drafts a second time is refused and copies nothing", async ({
  page,
}) => {
  const folder = await openScratch(page);
  const copyReadmeToDrafts = async () => {
    const dialog = await openTransfer(page, "README.txt", "Copy");
    await pickerFolder(dialog, "Drafts").click();
    await expect(destinationOf(dialog)).toContainText("Drafts");
    await dialog.getByRole("button", { name: "Copy here" }).click();
    return dialog;
  };

  let dialog = await copyReadmeToDrafts();
  await shown(onScreen(page, `Copied “README.txt” to ${folder}/Drafts.`));
  await expect(dialog).toHaveCount(0);
  // A copy leaves the original where it was.
  await shown(page.getByRole("link", { name: "README.txt", exact: true }));

  dialog = await copyReadmeToDrafts();
  // The dialog stays open and says it, at the destination it refused.
  await shown(dialog.getByText(`Something named “README.txt” is already in ${folder}/Drafts.`));
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("link", { name: "Drafts", exact: true }).click();
  await expect.poll(() => listed(page)).toEqual(["blog-post-self-hosting.md", "README.txt"]);
});

test("A destination that is gone: a folder removed while the picker is open says so when opened, and the copy is refused", async ({
  page,
}) => {
  const folder = await openScratch(page);
  const dialog = await openTransfer(page, "README.txt", "Copy");
  await shown(pickerFolder(dialog, "Scans"));
  // Another client removes Scans after the picker listed it.
  await dav(page.request, "DELETE", `${folder}/Scans`, { isFolder: true });
  await pickerFolder(dialog, "Scans").click();
  await shown(dialog.getByText(`${folder}/Scans is no longer there.`));
  await dialog.getByRole("button", { name: "Copy here" }).click();
  await shown(dialog.getByText("The destination folder does not exist."));
  await expect(dialog).toBeVisible();
});

test("Locking a file: the row shows the lock, other clients cannot change the file, and Unlock frees it", async ({
  page,
}) => {
  const folder = await openScratch(page);
  await page.getByRole("button", { name: "Actions for README.txt", exact: true }).click();
  await page.getByRole("menuitem", { name: "Lock", exact: true }).click();
  await shown(onScreen(page, "Locked “README.txt”."));
  const row = page.getByRole("row").filter({
    has: page.getByRole("link", { name: "README.txt", exact: true }),
  });
  await shown(row.getByRole("img", { name: /^Locked/ }));
  // A client without the lock's token cannot replace the file.
  await expect(
    dav(page.request, "PUT", `${folder}/README.txt`, { body: "changed" }),
  ).rejects.toThrow(/423/);

  await page.getByRole("button", { name: "Actions for README.txt", exact: true }).click();
  await page.getByRole("menuitem", { name: "Unlock", exact: true }).click();
  await shown(onScreen(page, "Unlocked “README.txt”."));
  await expect(row.getByRole("img", { name: /^Locked/ })).toHaveCount(0);
  await dav(page.request, "PUT", `${folder}/README.txt`, { body: "changed" });
  expect(await stored(page, `${folder}/README.txt`)).toBe("changed");
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

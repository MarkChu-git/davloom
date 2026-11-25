import { writeFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { filesAt, listed, onScreen, shown } from "./helpers";
import { dav, README, SAMPLE_NAMES, scratchFolder } from "./instances";

// The core flows of the File Explorer with names that WebDAV paths have to carry (PRD §11): letters
// beyond ASCII, spaces, and the characters a URL reserves, in a folder made in the Dashboard, in a
// file uploaded through it, and in a copy into each folder of the sample. Each test works in a
// folder of its own in the Mount "files" (instances.ts) and checks what reached the server.

/** Folder names, each needing something of the path that carries it. */
const FOLDER_NAMES = [
  "Receipts 2026",
  "Zürich Ünïcödé",
  "日本語のフォルダ",
  "Фото",
  "📷 Camera roll",
  "50% done",
  "Q&A + notes",
  "#tags",
  "semi;colon=equals",
  "it's (a) [copy]",
] as const;

/** File names to upload, each with its own text. */
const FILE_NAMES = [
  "notes.txt",
  "Résumé 2026.md",
  "报告-最终版.txt",
  "100% sure.txt",
  "issue #42.txt",
  "x+y=z.csv",
  "data.v2.json",
  "~tilde & ampersand.txt",
] as const;

/** The folders at the top of the sample, which a copy of README.txt can go to. */
const SAMPLE_FOLDERS = ["Contracts", "Drafts", "Invoices 2026", "Scans"] as const;

/** Opens a folder of the test's own, with the sample in it or empty. */
const openScratch = async (page: Page, withSample: boolean): Promise<string> => {
  const folder = await scratchFolder(page.request, { withSample });
  await page.goto(filesAt(folder));
  if (withSample) {
    await expect.poll(() => listed(page)).toHaveLength(SAMPLE_NAMES.length);
  } else {
    await shown(page.getByRole("heading", { name: "This folder is empty" }));
  }
  return folder;
};

/** The status a PROPFIND of one path answers with, the folder alone. */
const propfindStatus = async (page: Page, path: string, isFolder: boolean) =>
  (await dav(page.request, "PROPFIND", path, { isFolder, headers: { depth: "0" } })).status();

for (const name of FOLDER_NAMES) {
  test(`A folder named ${name}: New folder makes it on the server, the list shows it, and it opens empty`, async ({
    page,
  }) => {
    const folder = await openScratch(page, false);
    await page.getByRole("button", { name: "New folder" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("button", { name: "Create folder" }).click();
    await shown(onScreen(page, `Created “${name}”.`));
    await expect.poll(() => listed(page)).toEqual([name]);
    expect(await propfindStatus(page, `${folder}/${name}`, true)).toBe(207);

    await page.getByRole("link", { name, exact: true }).click();
    await shown(page.getByRole("heading", { name: "This folder is empty" }));
    expect(new URL(page.url()).searchParams.get("path")).toBe(`${folder}/${name}`);
  });
}

for (const name of FILE_NAMES) {
  test(`Uploading ${name}: the file reaches the server under its name with its bytes, and the list shows it`, async ({
    page,
  }, testInfo) => {
    const text = `The file ${name}, uploaded through the Dashboard.\n`;
    const path = testInfo.outputPath(name);
    writeFileSync(path, text);
    const folder = await openScratch(page, false);
    await page.getByRole("button", { name: "Upload", exact: true }).first().click();
    await page.locator('input[type="file"]').setInputFiles(path);

    await shown(onScreen(page, `Uploaded 1 file to ${folder}.`));
    await expect.poll(() => listed(page)).toEqual([name]);
    expect(await (await dav(page.request, "GET", `${folder}/${name}`)).text()).toBe(text);
  });
}

for (const target of SAMPLE_FOLDERS) {
  test(`Copying README.txt into ${target}: the picker opens ${target}, the copy lands there, and the original stays`, async ({
    page,
  }) => {
    const folder = await openScratch(page, true);
    await page.getByRole("button", { name: "Actions for README.txt", exact: true }).click();
    await page.getByRole("menuitem", { name: "Copy", exact: true }).click();
    const dialog = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "Copy “README.txt”", exact: true }) });
    await dialog.getByRole("button", { name: target, exact: true }).click();
    await expect(dialog.getByRole("navigation", { name: "Destination" })).toContainText(target);
    await dialog.getByRole("button", { name: "Copy here" }).click();

    await shown(onScreen(page, `Copied “README.txt” to ${folder}/${target}.`));
    await shown(page.getByRole("link", { name: "README.txt", exact: true }));
    expect(await (await dav(page.request, "GET", `${folder}/${target}/README.txt`)).text()).toBe(
      README,
    );
    expect(await (await dav(page.request, "GET", `${folder}/README.txt`)).text()).toBe(README);
  });
}

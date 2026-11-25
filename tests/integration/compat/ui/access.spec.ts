import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { filesAt, isNarrow, onScreen, openList, openRowDetails, recordOf, shown } from "./helpers";
import { scratchFolder, unique } from "./instances";

// The core flows of giving access (PRD §11): an API Key of each access level and each expiry,
// made in Credentials and used by a WebDAV client, and a mount of each kind of name, made in
// Storage & Mounts and reached in Files and over WebDAV, or refused with the reason. Keys and
// mounts are shared by every test, so each test names its own uniquely.

const ACCESS = [
  { access: "Read and write", readOnly: false, put: 201 },
  { access: "Read only", readOnly: true, put: 403 },
] as const;

/** The expiry choices of the form, and how many days each gives the key; null never ends. */
const EXPIRY = [
  { label: "In 30 days", days: 30 },
  { label: "In 90 days", days: 90 },
  { label: "In a year", days: 365 },
  { label: "Never", days: null },
] as const;

const inDays = (days: number): string =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(Date.now() + days * 86_400_000),
  );

/** What a key's record says: in its table row, or in the details a narrow page opens. */
const keyRecord = async (page: Page, name: string) =>
  isNarrow(page) ? await openRowDetails(page, "key", name) : recordOf(page, "key", name);

const basic = (key: string) => ({ authorization: `Basic ${btoa(`client:${key}`)}` });

for (const { access, readOnly, put } of ACCESS) {
  for (const { label, days } of EXPIRY) {
    test(`A ${access.toLowerCase()} key that expires ${label.toLowerCase()}: the list says so, and a WebDAV client ${readOnly ? "reads but cannot write" : "reads and writes"} with it`, async ({
      page,
      request,
    }) => {
      const name = unique(readOnly ? "Reader" : "Writer");
      const folder = await scratchFolder(page.request, { withSample: false });
      await page.goto("/credentials");
      await page.getByRole("button", { name: "Create key" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill(name);
      if (readOnly) await dialog.getByRole("switch", { name: "Read only" }).click();
      if (label !== "In 90 days") {
        await openList(page, "combobox", "Expires", dialog);
        await page.getByRole("option", { name: label, exact: true }).click();
      }
      await expect(dialog.getByRole("combobox", { name: "Expires" })).toHaveText(label);
      await dialog.getByRole("button", { name: "Create key" }).click();

      await shown(page.getByRole("heading", { name: `Key “${name}” is ready` }));
      const key = await page.getByRole("textbox", { name: "API key", exact: true }).inputValue();
      await page.getByRole("button", { name: "Done" }).click();
      const record = await keyRecord(page, name);
      await expect(record).toContainText(access);
      await expect(record).toContainText(days === null ? "Never" : inDays(days));

      const listing = await request.fetch(`/dav${folder}/`, {
        method: "PROPFIND",
        headers: { depth: "1", ...basic(key) },
      });
      expect(listing.status()).toBe(207);
      const written = await request.fetch(`/dav${folder}/from-a-client.txt`, {
        method: "PUT",
        headers: basic(key),
        data: "Written by a WebDAV client.",
      });
      expect(written.status()).toBe(put);
    });
  }
}

/** Mount names that a path segment carries, some beyond ASCII and with reserved characters. */
const MOUNT_NAMES = ["photos", "Backups 2026", "música", "日本", "a.b_c-d", "Q&A"] as const;

/** Names the form refuses before it sends anything, with what it says. */
const REFUSED_NAMES = [
  { name: "", reason: "Enter a folder name." },
  { name: "photos/2026", reason: "Use one folder name, without slashes." },
  { name: ".", reason: "Choose another folder name." },
] as const;

const openAddForm = async (page: Page) => {
  await page.goto("/storage");
  await page.getByRole("button", { name: "Add mount" }).click();
  const dialog = page.getByRole("dialog");
  await shown(dialog.getByLabel("Folder name"));
  return dialog;
};

for (const prefix of MOUNT_NAMES) {
  test(`A mount named ${prefix}: Add mount lists it, Files shows it at the top, and WebDAV serves it`, async ({
    page,
  }) => {
    const name = unique(prefix);
    const dialog = await openAddForm(page);
    await dialog.getByLabel("Folder name").fill(name);
    await dialog.getByRole("button", { name: "Add mount" }).click();
    await shown(onScreen(page, `Added /${name}.`));
    await expect(recordOf(page, "mount", `/${name}`)).toHaveCount(1);

    await page.goto(filesAt("/"));
    await shown(page.getByRole("link", { name, exact: true }));
    const listing = await page.request.fetch(`/dav/${encodeURIComponent(name)}/`, {
      method: "PROPFIND",
      headers: { depth: "0", "x-davloom-dashboard": "1" },
    });
    expect(listing.status()).toBe(207);
  });
}

for (const { name, reason } of REFUSED_NAMES) {
  test(`A mount named ${JSON.stringify(name)}: the form stays open and says ${reason}`, async ({
    page,
  }) => {
    const dialog = await openAddForm(page);
    await dialog.getByLabel("Folder name").fill(name);
    await dialog.getByRole("button", { name: "Add mount" }).click();
    await shown(onScreen(page, reason));
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });
}

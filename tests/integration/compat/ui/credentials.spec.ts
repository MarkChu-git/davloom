import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { isNarrow, onScreen, openRowDetails, recordOf, rowAction, shown } from "./helpers";
import { createKey, unique, WORKERS_ORIGIN } from "./instances";

// The Credentials scenarios about the key list, creating a key and revoking one, against the
// Worker's real API. Every test names its keys uniquely, since all tests share one instance. The
// ones about a key's row on a phone have their tests in dashboard.spec.ts. A narrow page lists keys
// as rows that open in place rather than in a table, so the checks of a key read either layout.

/** The row of a key in the table, found by its name. */
const rowOf = (page: Page, name: string): Locator =>
  page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });

/** What a key's row says in one of its columns. */
const columnOf = (row: Locator, column: "Access" | "Expires" | "Status"): Locator =>
  row.getByRole("cell").nth({ Access: 1, Expires: 3, Status: 4 }[column]);

/** Text a page shows, as a pattern that lets the layout put space between its parts. */
const spaced = (...parts: string[]): RegExp =>
  new RegExp(parts.map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*"));

/** Checks what the list says about a key: in the table's columns, or in its row's details. */
const expectKey = async (
  page: Page,
  name: string,
  {
    access,
    reaches,
    expires,
    status,
  }: { access?: string; reaches?: string; expires?: string; status?: string },
) => {
  if (!isNarrow(page)) {
    const row = rowOf(page, name);
    if (access !== undefined) {
      await expect(columnOf(row, "Access")).toHaveText(`${access}${reaches ?? ""}`);
    }
    if (expires !== undefined) await expect(columnOf(row, "Expires")).toHaveText(expires);
    if (status !== undefined) await expect(columnOf(row, "Status")).toHaveText(status);
    return;
  }
  if (status !== undefined) await expect(recordOf(page, "key", name)).toContainText(status);
  const details = await openRowDetails(page, "key", name);
  if (access !== undefined) await expect(details).toContainText(spaced("Access", access));
  if (reaches !== undefined) await expect(details).toContainText(spaced("Reaches", reaches));
  if (expires !== undefined) await expect(details).toContainText(spaced("Expires", expires));
};

/** Opens the form that creates a key. */
const openForm = async (page: Page): Promise<Locator> => {
  await page.goto("/credentials");
  await page.getByRole("button", { name: "Create key" }).first().click();
  const dialog = page.getByRole("dialog");
  await shown(dialog.getByLabel("Name"));
  return dialog;
};

const inDays = (days: number): string =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(Date.now() + days * 86_400_000),
  );

test("Keys from the API: each key shows its access, its expiry and its status", async ({
  page,
}) => {
  const reader = unique("Accountant");
  const writer = unique("Laptop");
  await createKey(page.request, reader, "read-only", 30);
  await createKey(page.request, writer, "read-write", null);
  await page.goto("/credentials");
  await expectKey(page, reader, { access: "Read only", expires: inDays(30), status: "Active" });
  await expectKey(page, writer, { access: "Read and write", expires: "Never" });
});

test("A key without a name: the form stays open and asks for a name only after the submit", async ({
  page,
}) => {
  const reason = "Name the key after the device or person that will use it.";
  const dialog = await openForm(page);
  await expect(onScreen(page, reason)).toHaveCount(0);

  await dialog.getByRole("button", { name: "Create key" }).click();
  await shown(onScreen(page, reason));
  await expect(dialog).toBeVisible();
});

test("A key limited to folders: the list shows its access with the folders it reaches", async ({
  page,
}) => {
  const name = unique("Photo frame");
  const dialog = await openForm(page);
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("switch", { name: "Read only" }).click();
  await dialog.getByLabel("Folders").fill("files/photos, /files/albums/");
  await dialog.getByRole("button", { name: "Create key" }).click();
  await shown(page.getByRole("heading", { name: `Key “${name}” is ready` }));
  await page.getByRole("button", { name: "Done" }).click();
  await expectKey(page, name, { access: "Read only", reaches: "/files/photos, /files/albums" });
});

test("Folders that name no folder: the form stays open and says why", async ({ page }) => {
  const dialog = await openForm(page);
  await dialog.getByLabel("Name").fill(unique("Bad scope"));
  await dialog.getByLabel("Folders").fill("/");
  await dialog.getByRole("button", { name: "Create key" }).click();
  await shown(onScreen(page, "Name a mount or a folder inside one, such as /files/photos."));
  await expect(dialog).toBeVisible();
});

test("Creating a key: the dialog shows the whole key once, with how to connect, and after Done the list holds only its first characters", async ({
  page,
  request,
}) => {
  const name = unique("Work laptop");
  const dialog = await openForm(page);
  await dialog.getByLabel("Name").fill(name);
  // A key expires in 90 days unless the user chooses another time.
  await expect(dialog.getByRole("combobox", { name: "Expires" })).toHaveText("In 90 days");
  await dialog.getByRole("button", { name: "Create key" }).click();

  await shown(page.getByRole("heading", { name: `Key “${name}” is ready` }));
  const field = page.getByRole("textbox", { name: "API key", exact: true });
  const key = await field.inputValue();
  expect(key).toMatch(/^dav_\w{20,}$/);
  await shown(page.getByRole("button", { name: "Copy key" }));
  await shown(page.getByRole("alertdialog").getByText(`${WORKERS_ORIGIN}/dav/`));

  // The key works: a WebDAV client signs in with it as the password.
  const listing = await request.fetch("/dav/", {
    method: "PROPFIND",
    headers: { depth: "1", authorization: `Basic ${btoa(`finder:${key}`)}` },
  });
  expect(listing.status()).toBe(207);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: `Key “${name}” is ready` })).toHaveCount(0);
  // The page no longer holds the key, beyond its first characters in the list.
  const held = await page.evaluate(
    (secret) => ({
      inText:
        document.body.innerHTML.includes(secret.slice(0, 14)) ||
        (document.body.textContent ?? "").includes(secret.slice(0, 14)),
      inField: [...document.querySelectorAll("input, textarea")].some(
        (element) =>
          (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
          element.value.includes(secret.slice(0, 14)),
      ),
    }),
    key,
  );
  expect(held).toEqual({ inText: false, inField: false });

  await expect(recordOf(page, "key", name)).toContainText(key.slice(0, 6));
  await expectKey(page, name, { expires: inDays(90) });
});

test("Revoking a key: the confirmation warns that access ends for good, the key leaves the list, and it no longer opens WebDAV", async ({
  page,
  request,
}) => {
  const name = unique("Old tablet");
  const key = await createKey(page.request, name);
  await page.goto("/credentials");
  await rowAction(page, "key", name, "Revoke");

  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText(`Revoke “${name}”?`);
  await expect(confirmation).toContainText(
    "Clients signed in with it lose access, and this cannot be undone.",
  );
  await confirmation.getByRole("button", { name: "Revoke" }).click();

  await expect(recordOf(page, "key", name)).toHaveCount(0);
  await shown(onScreen(page, `Revoked “${name}”.`));
  // An isolate that checked the key in the last 30 s may still take it, so the check polls.
  await expect
    .poll(
      async () =>
        (
          await request.fetch("/dav/", {
            method: "PROPFIND",
            headers: { depth: "0", authorization: `Basic ${btoa(`x:${key}`)}` },
          })
        ).status(),
      { timeout: 40_000, intervals: [1_000] },
    )
    .toBe(401);
});

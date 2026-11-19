import { expect, test, type Locator, type Page } from "@playwright/test";
import { onScreen, openList, shown } from "./helpers";

// The Credentials scenarios about the key list, creating a key and revoking one. The ones about
// a key's row on a phone and about a folder outside the mount have their tests in
// dashboard.spec.ts.

/** The row of a key in the table, found by its name. */
const rowOf = (page: Page, name: string): Locator =>
  page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });

/** What a key's row says in one of its columns. */
const columnOf = (row: Locator, column: "Scope" | "Expires" | "Status"): Locator =>
  row.getByRole("cell").nth({ Scope: 2, Expires: 4, Status: 5 }[column]);

/** Opens the form that creates a key. */
const openForm = async (page: Page): Promise<Locator> => {
  await page.goto("/credentials");
  await page.getByRole("button", { name: "Create key" }).click();
  const dialog = page.getByRole("dialog");
  await shown(dialog.getByLabel("Name"));
  return dialog;
};

test("The sample keys: the list shows five keys, with Phone photo backup on /photos, Old tablet revoked and Conference laptop expired", async ({
  page,
}) => {
  await page.goto("/credentials");
  // The header row and a row for each key.
  await expect(page.getByRole("row")).toHaveCount(6);
  await expect(columnOf(rowOf(page, "Phone photo backup"), "Scope")).toHaveText("/photos");
  await expect(columnOf(rowOf(page, "Phone photo backup"), "Status")).toHaveText("Active");
  await expect(columnOf(rowOf(page, "Old tablet"), "Status")).toHaveText("Revoked");
  await expect(columnOf(rowOf(page, "Conference laptop"), "Status")).toHaveText("Expired");
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

test("A folder needs a mount: the folder field is off for All mounts and on once a mount is chosen", async ({
  page,
}) => {
  const dialog = await openForm(page);
  const folder = dialog.getByLabel("Folder inside the mount");
  await expect(dialog.getByRole("combobox", { name: "Mount" })).toHaveText("All mounts");
  await expect(folder).toBeDisabled();

  await openList(page, "combobox", "Mount");
  await page.getByRole("option", { name: "/documents" }).click();
  await expect(folder).toBeEnabled();

  await openList(page, "combobox", "Mount");
  await page.getByRole("option", { name: "All mounts" }).click();
  await expect(folder).toBeDisabled();
});

test("Creating a key: the dialog shows the whole key once, and after Done the list holds only its first characters", async ({
  page,
}) => {
  const dialog = await openForm(page);
  await dialog.getByLabel("Name").fill("Work laptop");
  // A key expires in 90 days unless the user chooses another time.
  await expect(dialog.getByRole("combobox", { name: "Expires" })).toHaveText("In 90 days");
  await dialog.getByRole("button", { name: "Create key" }).click();

  await shown(page.getByRole("heading", { name: "Key “Work laptop” is ready" }));
  const field = page.getByRole("textbox", { name: "API key", exact: true });
  const key = await field.inputValue();
  expect(key).toMatch(/^dvl_[A-Z2-7]{32}$/);
  await shown(page.getByRole("button", { name: "Copy key" }));

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Key “Work laptop” is ready" })).toHaveCount(0);
  // The page no longer holds the key, beyond its first characters in the list.
  const held = await page.evaluate(
    (secret) => ({
      inText:
        document.body.innerHTML.includes(secret.slice(0, 9)) ||
        (document.body.textContent ?? "").includes(secret.slice(0, 9)),
      inField: [...document.querySelectorAll("input, textarea")].some(
        (element) =>
          (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
          element.value.includes(secret.slice(0, 9)),
      ),
    }),
    key,
  );
  expect(held).toEqual({ inText: false, inField: false });

  const first = page.getByRole("row").nth(1);
  await expect(first).toContainText("Work laptop");
  await expect(first).toContainText(`${key.slice(0, 8)}…`);
  await expect(columnOf(first, "Expires")).toHaveText("Feb 14, 2027");
});

test("Revoking a key: the confirmation warns that access ends for good, and the revoked key offers Revoke only as unavailable", async ({
  page,
}) => {
  await page.goto("/credentials");
  const row = rowOf(page, "Laptop (Finder)");
  await page.getByRole("button", { name: "Actions for key Laptop (Finder)" }).click();
  await page.getByRole("menuitem", { name: "Revoke" }).click();

  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Revoke “Laptop (Finder)”?");
  await expect(confirmation).toContainText(
    "Clients signed in with it lose access, and this cannot be undone.",
  );
  await confirmation.getByRole("button", { name: "Revoke" }).click();

  await expect(columnOf(row, "Status")).toHaveText("Revoked");
  await page.getByRole("button", { name: "Actions for key Laptop (Finder)" }).click();
  await expect(page.getByRole("menuitem", { name: "Revoke" })).toBeDisabled();
});

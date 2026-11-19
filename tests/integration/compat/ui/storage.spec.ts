import { expect, test, type Page } from "@playwright/test";
import {
  cardWith,
  installClock,
  listed,
  onScreen,
  shown,
  sideNavigation,
  stopTimers,
} from "./helpers";

// The Storage & Mounts scenarios about the backends, checking one, adding, editing and removing a
// mount. The ones about the backend cards on one grid and about opening the form again have their
// tests in dashboard.spec.ts. The Overview's scenario of the same name as "The sample backends"
// has its test in overview.spec.ts.

/** The card of a backend, found by its name. */
const backendCard = (page: Page, name: string) =>
  cardWith(page, page.getByRole("heading", { level: 3, name, exact: true }));

/** Opens the form that adds a mount. */
const openAddForm = async (page: Page) => {
  await page.goto("/storage");
  await page.getByRole("button", { name: "Add mount" }).click();
  return page.getByRole("dialog");
};

/** Opens a mount's form from the menu of its row. */
const openEditForm = async (page: Page, path: string) => {
  await page.getByRole("button", { name: `Actions for mount ${path}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  return page.getByRole("dialog");
};

test("The sample backends: Durable Objects shows 1.9 GB of 5 GB with a bar, R2 photos shows 41.2 GB with no fixed limit, and RustFS archive is marked Unreachable", async ({
  page,
}) => {
  await page.goto("/storage");
  const durable = backendCard(page, "Durable Objects");
  const photos = backendCard(page, "R2 photos");
  const archive = backendCard(page, "RustFS archive");
  await shown(durable);

  await expect(durable).toContainText("1.9 GB of 5 GB");
  const bar = durable.getByRole("progressbar", { name: "Durable Objects capacity used" });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("aria-valuenow", "1860000000");
  await expect(bar).toHaveAttribute("aria-valuemax", "5000000000");

  await expect(photos).toContainText("41.2 GB, no fixed limit");
  await expect(photos.getByRole("progressbar")).toHaveCount(0);

  await expect(archive).toContainText("Unreachable");
  await expect(durable).not.toContainText("Unreachable");
  await expect(photos).not.toContainText("Unreachable");
});

test("A backend that still does not answer: the button shows the check running, then the card and an assertive announcement say RustFS archive is still unreachable", async ({
  page,
}) => {
  await installClock(page);
  await stopTimers(page);
  await page.goto("/storage");
  const card = backendCard(page, "RustFS archive");
  const verify = card.getByRole("button", { name: "Verify connection" });
  await shown(verify);

  await verify.click();
  await expect(verify).toHaveAttribute("aria-busy", "true");

  // The check ends after a short pause, as it would while the backend is asked.
  await page.clock.runFor(1000);
  await expect(verify).not.toHaveAttribute("aria-busy", "true");
  await expect(card).toContainText("Still unreachable, no answer within 30 s");
  // An unreachable backend is announced at once, not politely.
  await expect(page.locator('[data-astryx-live-region="assertive"]')).toHaveText(
    "RustFS archive is still unreachable: no answer within 30 s.",
  );
});

test("A folder name already in use: adding a mount named documents keeps the form open and says another mount already uses this folder", async ({
  page,
}) => {
  const dialog = await openAddForm(page);
  await dialog.getByLabel("Folder name").fill("documents");
  await dialog.getByRole("button", { name: "Add mount" }).click();

  await shown(onScreen(page, "Another mount already uses this folder."));
  await expect(dialog).toBeVisible();
  // Nothing was added or replaced: the header row and the four mounts, and /documents as it was.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("row")).toHaveCount(5);
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("button", { name: "Actions for mount /documents" }),
    }),
  ).toContainText("default/documents/");
});

test("A dot segment: adding a mount named .. keeps the form open and asks for another folder name", async ({
  page,
}) => {
  const dialog = await openAddForm(page);
  await dialog.getByLabel("Folder name").fill("..");
  await dialog.getByRole("button", { name: "Add mount" }).click();

  await shown(onScreen(page, "Choose another folder name."));
  await expect(dialog).toBeVisible();
  // Nothing was added: the header row and the four mounts.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("row")).toHaveCount(5);
});

test("Editing a mount: the form for /photos shows R2 photos and davloom-photos, the one for /archive shows its prefix, and the folder name cannot change", async ({
  page,
}) => {
  await page.goto("/storage");
  const dialog = await openEditForm(page, "/photos");
  await shown(dialog.getByRole("heading", { name: "Edit /photos" }));
  const folder = dialog.getByLabel("Folder name");
  await expect(folder).toHaveValue("photos");
  await expect(folder).toBeDisabled();
  // Typing does nothing, which the attributes alone do not prove.
  await folder.focus();
  await page.keyboard.type("x");
  await expect(folder).toHaveValue("photos");
  await expect(dialog.getByRole("combobox", { name: /^Backend/ })).toContainText("R2 photos");
  await expect(dialog.getByLabel("Bucket")).toHaveValue("davloom-photos");
  await expect(dialog.getByLabel("Prefix")).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  // /photos has no prefix, so a mount that has one shows what the form does with it.
  const archive = await openEditForm(page, "/archive");
  await shown(archive.getByRole("heading", { name: "Edit /archive" }));
  await expect(archive.getByRole("combobox", { name: /^Backend/ })).toContainText("RustFS archive");
  await expect(archive.getByLabel("Bucket")).toHaveValue("davloom-archive");
  await expect(archive.getByLabel("Prefix")).toHaveValue("backups/");
});

test("Removing a mount keeps its files: the confirmation says the files stay in the bucket, and /shared leaves the mount list and the top level of Files", async ({
  page,
}) => {
  await page.goto("/storage");
  await page.getByRole("button", { name: "Actions for mount /shared" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();

  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Remove /shared?");
  await expect(confirmation).toContainText("Its files stay in the bucket.");
  await confirmation.getByRole("button", { name: "Remove mount" }).click();

  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Actions for mount /shared" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Actions for mount \// })).toHaveCount(3);
  // Files is reached from inside the page, since a reload would bring the samples back.
  await sideNavigation(page).getByRole("link", { name: "Files" }).click();
  await expect
    .poll(async () => (await listed(page)).toSorted())
    .toEqual(["archive", "documents", "photos"]);
});

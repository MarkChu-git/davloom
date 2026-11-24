import { expect, test, type Page } from "@playwright/test";
import {
  cardWith,
  filesAt,
  listed,
  onScreen,
  openList,
  shown,
  withUnavailableBackend,
} from "./helpers";
import { createMount, dav, scratchFolder, unique } from "./instances";

// The Storage & Mounts scenarios about the backends, adding, renaming and removing a mount, on the
// Worker's real API. Mounts and backends are shared by every test, so each test names its own
// uniquely. The ones about the backend cards on one grid and about opening the form again have
// their tests in dashboard.spec.ts.

/** The card of a backend, found by its name. */
const backendCard = (page: Page, name: string) =>
  cardWith(page, page.getByRole("heading", { level: 3, name, exact: true }));

/** The row of a mount, found by its path. */
const mountRow = (page: Page, path: string) =>
  page.getByRole("row").filter({
    has: page.getByRole("button", { name: `Actions for mount ${path}`, exact: true }),
  });

/** Opens the form that adds a mount. */
const openAddForm = async (page: Page) => {
  await page.goto("/storage");
  await page.getByRole("button", { name: "Add mount" }).click();
  return page.getByRole("dialog");
};

test("The default backend: its card names Durable Objects, says it is available, and counts what it holds", async ({
  page,
}) => {
  await page.goto("/storage");
  const card = backendCard(page, "Default");
  await shown(card);
  await expect(card).toContainText("Cloudflare Durable Objects");
  await expect(card).toContainText("Available");
  await expect(card).toContainText(/Stored\s*[\d.]+ (bytes|kB|MB)/);
  await expect(card).toContainText(/Files\s*\d+/);
  await expect(card).toContainText(/Folders\s*\d+/);
  // No capacity is known, so no bar pretends to show one.
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  // Connections are checked when the list is read, so there is no button for it.
  await expect(card.getByRole("button", { name: "Verify connection" })).toHaveCount(0);
});

test("A backend that does not answer: its card says Unavailable, its counts are unknown, and the navigation names it on every page", async ({
  page,
}) => {
  await withUnavailableBackend(page);
  await page.goto("/storage");
  const card = backendCard(page, "Default");
  await expect(card).toContainText("Unavailable");
  await expect(card).toContainText(/Stored\s*Unknown/);
  await expect(
    page.getByRole("navigation", { name: "Side navigation" }).getByRole("link", {
      name: /^Storage & Mounts\b.*unavailable/,
    }),
  ).toBeVisible();
});

test("Adding a backend: a Durable Objects backend with its own name joins the list, empty", async ({
  page,
}) => {
  const name = unique("Archive");
  await page.goto("/storage");
  await page.getByRole("button", { name: "Add backend" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Cloudflare Durable Objects");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Add backend" }).click();

  await shown(onScreen(page, `Added backend “${name}”.`));
  const card = backendCard(page, name);
  await expect(card).toContainText(/Files\s*0/);
  await expect(card).toContainText(/Mounts\s*0/);
});

test("Adding a mount: the new mount shows a folder of the backend, and Files lists what that folder holds", async ({
  page,
}) => {
  const folder = await scratchFolder(page.request, { withSample: false });
  await dav(page.request, "PUT", `${folder}/inside.txt`, { body: "inside" });
  const root = folder.split("/").at(-1) ?? "";
  const name = unique("projects");
  const dialog = await openAddForm(page);
  await dialog.getByLabel("Folder name").fill(` /${name}/ `);
  // The default backend's folder holds what the Mount "files" shows, which is its whole backend.
  await dialog.getByLabel("Folder in the backend").fill(root);
  await dialog.getByRole("button", { name: "Add mount" }).click();

  await shown(onScreen(page, `Added /${name}.`));
  await expect(mountRow(page, `/${name}`)).toContainText("Default");
  await expect(mountRow(page, `/${name}`)).toContainText(`/${root}`);
  await page.goto(filesAt(`/${name}`));
  await expect.poll(() => listed(page)).toEqual(["inside.txt"]);
});

test("A folder the backend does not have: adding the mount is refused at the folder field", async ({
  page,
}) => {
  const dialog = await openAddForm(page);
  await dialog.getByLabel("Folder name").fill(unique("nowhere"));
  await dialog.getByLabel("Folder in the backend").fill(unique("missing"));
  await dialog.getByRole("button", { name: "Add mount" }).click();
  await shown(onScreen(page, "No folder of this name is in the backend."));
  await expect(dialog).toBeVisible();
});

test("A folder name already in use: adding a mount named files keeps the form open and says another mount already uses this folder", async ({
  page,
}) => {
  const dialog = await openAddForm(page);
  await dialog.getByLabel("Folder name").fill("files");
  await dialog.getByRole("button", { name: "Add mount" }).click();

  await shown(onScreen(page, "Another mount already uses this folder."));
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(mountRow(page, "/files")).toHaveCount(1);
});

test("A dot segment: adding a mount named .. keeps the form open and asks for another folder name", async ({
  page,
}) => {
  const dialog = await openAddForm(page);
  await dialog.getByLabel("Folder name").fill("..");
  await dialog.getByRole("button", { name: "Add mount" }).click();

  await shown(onScreen(page, "Choose another folder name."));
  await expect(dialog).toBeVisible();
});

test("Renaming a mount: the form keeps its backend and folder, and the new name reaches Files and WebDAV", async ({
  page,
}) => {
  const before = unique("old");
  const after = unique("new");
  await createMount(page.request, before);
  await page.goto("/storage");
  await page.getByRole("button", { name: `Actions for mount /${before}` }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog");
  await shown(dialog.getByRole("heading", { name: `Rename /${before}` }));
  await expect(dialog).toContainText(/Backend\s*Default/);
  await expect(dialog).toContainText(/Folder\s*Whole backend/);
  await dialog.getByLabel("Folder name").fill(after);
  await dialog.getByRole("button", { name: "Rename" }).click();

  await shown(onScreen(page, `Renamed to /${after}.`));
  await expect(mountRow(page, `/${after}`)).toHaveCount(1);
  await expect(mountRow(page, `/${before}`)).toHaveCount(0);
  await expect
    .poll(async () =>
      (
        await page.request.fetch(`/dav/${after}/`, {
          method: "PROPFIND",
          headers: { depth: "0", "x-davloom-dashboard": "1" },
        })
      ).status(),
    )
    .toBe(207);
});

test("Removing a mount keeps its files: the confirmation says the files stay in the backend, and the mount leaves the list and the top level of Files", async ({
  page,
}) => {
  const name = unique("shared");
  await createMount(page.request, name);
  await page.goto("/storage");
  await page.getByRole("button", { name: `Actions for mount /${name}` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();

  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText(`Remove /${name}?`);
  await expect(confirmation).toContainText("Its files stay in the backend");
  await confirmation.getByRole("button", { name: "Remove mount" }).click();

  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Actions for mount /${name}` })).toHaveCount(0);
  await page.goto("/files");
  await shown(page.getByRole("row").getByRole("link", { name: "files", exact: true }));
  expect(await listed(page)).not.toContain(name);
});

test("Moving a mount: the dialog offers the other backends and a folder, says to copy the files first, and the mount keeps its name", async ({
  page,
}) => {
  const name = unique("moving");
  await createMount(page.request, name);
  // A second backend for this page only, so the shared instance keeps one.
  await page.route("**/api/backends", async (route) => {
    const response = await route.fetch();
    const backends: unknown = await response.json();
    await route.fulfill({
      json: [
        ...(Array.isArray(backends) ? backends : []),
        {
          id: "b-second",
          name: "Second",
          kind: "s3",
          createdAt: "2026-11-24T00:00:00.000Z",
          available: true,
          usage: null,
        },
      ],
    });
  });
  const sent: unknown[] = [];
  let answer: { status: number; json: unknown } = {
    status: 400,
    json: { error: { code: "invalid_input" } },
  };
  await page.route("**/api/mounts/*", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    sent.push(route.request().postDataJSON());
    return route.fulfill(answer);
  });
  await page.goto("/storage");
  await page.getByRole("button", { name: `Actions for mount /${name}` }).click();
  await page.getByRole("menuitem", { name: "Move to another backend" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Move /${name}`);
  await expect(dialog).toContainText("Copy the files first");
  // Other tests may have added backends to the shared instance, so pick ours by name.
  await openList(page, "combobox", "Backend");
  await page.getByRole("option", { name: /Second/ }).click();
  await dialog.getByLabel("Folder in the backend").fill("archive/2026");
  await dialog.getByRole("button", { name: "Move mount" }).click();
  await shown(onScreen(page, "No folder of this name is in the backend."));
  expect(sent).toEqual([{ backendId: "b-second", root: "archive/2026" }]);

  answer = { status: 200, json: { id: "x" } };
  await dialog.getByRole("button", { name: "Move mount" }).click();
  await shown(onScreen(page, `/${name} now shows Second.`));
  await expect(dialog).toHaveCount(0);
});

import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  cardWith,
  filesAt,
  isNarrow,
  listed,
  navigationLinks,
  onScreen,
  openList,
  openRowDetails,
  recordOf,
  rowAction,
  shown,
  withUnavailableBackend,
} from "./helpers";
import { createMount, dav, MOUNT_TOP, scratchFolder, unique } from "./instances";

// The Storage & Mounts scenarios about the backends, adding, renaming and removing a mount, on the
// Worker's real API. Mounts and backends are shared by every test, so each test names its own
// uniquely. The ones about the backend cards on one grid and about opening the form again have
// their tests in dashboard.spec.ts. A narrow page lists mounts as rows that open in place, with
// Rename, Move and Remove in their details, so the steps on a mount go through either layout.

/** The card of a backend, found by its name. */
const backendCard = (page: Page, name: string) =>
  cardWith(page, page.getByRole("heading", { level: 3, name, exact: true }));

/** The row of a mount, found by its path. */
const mountRow = (page: Page, path: string) => recordOf(page, "mount", path);

/** Opens the form that adds a mount. */
const openAddForm = async (page: Page) => {
  await page.goto("/storage");
  await page.getByRole("button", { name: "Add mount" }).click();
  return page.getByRole("dialog");
};

test("The default backend: its card names Durable Objects, says it is available, counts what it holds, and meters its capacity", async ({
  page,
}) => {
  await page.goto("/storage");
  const card = backendCard(page, "Default");
  await shown(card);
  await expect(card).toContainText("Cloudflare Durable Objects");
  await expect(card).toContainText("Available");
  await expect(card).toContainText(/Endpoint\s*Built in/);
  await expect(card).toContainText(/Objects\s*[\d,]+/);
  // A Durable Object's storage has a known limit, which the bar measures what it stores against.
  await expect(card).toContainText(/Stored\s*[\d.,]+ (bytes?|kB|MB|GB) of [\d.,]+ (kB|MB|GB)/);
  await expect(card).toContainText(/Mounts\s*\d+/);
  await shown(card.getByRole("progressbar", { name: "Default capacity used" }));
  await expect(card).toContainText(/Last checked/);
});

test("Verifying a connection: the backend is asked again, and its card says how fast it answered", async ({
  page,
}) => {
  await page.goto("/storage");
  const card = backendCard(page, "Default");
  await card.getByRole("button", { name: "Verify connection" }).click();
  await shown(card.getByText(/^Answered just now, in [\d,]+ ms$/));
  await expect(card.getByText(/^Last checked/)).toHaveCount(0);
});

test("A connection that still fails: the card says the backend is still unavailable, and why", async ({
  page,
}) => {
  await page.route("**/api/backends/*/verify", (route) =>
    route.fulfill({
      json: {
        id: "default",
        name: "Default",
        available: false,
        latencyMs: null,
        reason: "timed out",
        checkedAt: new Date().toISOString(),
      },
    }),
  );
  await page.goto("/storage");
  const card = backendCard(page, "Default");
  await card.getByRole("button", { name: "Verify connection" }).click();
  await shown(card.getByText("Still unavailable: timed out"));
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
    (await navigationLinks(page)).getByRole("link", { name: /^Storage & Mounts\b.*unavailable/ }),
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
  await expect(card).toContainText(/Objects\s*0/);
  await expect(card).toContainText(/Mounts\s*0/);
});

test("Editing and removing a backend: Edit renames it, and Remove deletes it with its storage", async ({
  page,
}) => {
  const name = unique("Scratch");
  const renamed = unique("Renamed");
  await page.goto("/storage");
  await page.getByRole("button", { name: "Add backend" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Add backend" }).click();
  await shown(backendCard(page, name));

  await page.getByRole("button", { name: `Actions for backend ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  await shown(dialog.getByRole("heading", { name: `Edit ${name}` }));
  // A backend keeps its kind.
  await expect(dialog).toContainText(/Kind\s*Cloudflare Durable Objects/);
  await expect(dialog.getByLabel("Name")).toHaveValue(name);
  // Another backend's name is refused before anything is sent.
  await dialog.getByLabel("Name").fill("Default");
  await dialog.getByRole("button", { name: "Save" }).click();
  await shown(onScreen(page, "Another backend already has this name."));
  await dialog.getByLabel("Name").fill(renamed);
  await dialog.getByRole("button", { name: "Save" }).click();
  await shown(onScreen(page, `Saved “${renamed}”.`));
  await shown(backendCard(page, renamed));
  await expect(backendCard(page, name)).toHaveCount(0);

  await page.getByRole("button", { name: `Actions for backend ${renamed}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText(`Remove ${renamed}?`);
  await expect(confirmation).toContainText("Its storage is deleted with it.");
  await confirmation.getByRole("button", { name: "Remove backend" }).click();
  await shown(onScreen(page, `Removed “${renamed}” and its storage.`));
  await expect(backendCard(page, renamed)).toHaveCount(0);
});

test("A backend a mount uses: Remove says to move or remove the mount first", async ({ page }) => {
  await page.goto("/storage");
  await page.getByRole("button", { name: "Actions for backend Default", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Remove Default?");
  await expect(confirmation).toContainText(
    /\/files.* this backend\. Move or remove (it|them) first\./,
  );
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toHaveCount(0);
  await shown(backendCard(page, "Default"));
});

test("An S3-compatible backend: the form asks for its endpoint, bucket and keys, checks them, and sends them", async ({
  page,
}) => {
  const name = unique("Bucket");
  // The test instance reaches no S3 service, so the page's own answer stands in for the server's.
  let sent: unknown;
  await page.route("**/api/backends", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent = route.request().postDataJSON();
    return route.fulfill({ json: { id: "b-s3" } });
  });
  await page.goto("/storage");
  await page.getByRole("button", { name: "Add backend" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await openList(page, "combobox", "Kind");
  await page.getByRole("option", { name: "S3 compatible" }).click();
  // A field's name ends in whether it is required or optional.
  const field = (label: string) =>
    dialog.getByRole("textbox", { name: new RegExp(`^${label} (Required|Optional)$`) });
  await field("Endpoint").fill("ftp://s3.example.com");
  await field("Bucket").fill("No");
  await dialog.getByRole("button", { name: "Add backend" }).click();
  await shown(onScreen(page, "Enter the endpoint's URL, such as https://s3.example.com."));
  await shown(onScreen(page, "Use 3 to 63 lowercase letters, digits, dots and hyphens."));
  await shown(onScreen(page, "Enter the access key ID."));
  await shown(onScreen(page, "Enter the secret access key."));
  expect(sent).toBeUndefined();

  await field("Endpoint").fill(" https://s3.example.com ");
  await field("Bucket").fill("family-photos");
  await field("Prefix").fill("davloom");
  await field("Region").fill("eu-west-1");
  await field("Access key ID").fill("AKIAEXAMPLE");
  await field("Secret access key").fill("not-a-real-secret");
  await dialog.getByRole("button", { name: "Add backend" }).click();
  await shown(onScreen(page, `Added backend “${name}”.`));
  expect(sent).toEqual({
    name,
    kind: "s3",
    config: {
      endpoint: "https://s3.example.com",
      region: "eu-west-1",
      bucket: "family-photos",
      prefix: "davloom",
      forcePathStyle: true,
      accessKeyId: "AKIAEXAMPLE",
    },
    secretKey: "not-a-real-secret",
  });
});

test("Adding a mount: the new mount shows a folder of the backend, and Files lists what that folder holds", async ({
  page,
}) => {
  // At the top of the Mount, whose folder in the backend is the backend's top.
  const folder = await scratchFolder(page.request, { withSample: false, parent: MOUNT_TOP });
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
  // A narrow page names the folder in the row's details.
  await expect(
    isNarrow(page) ? await openRowDetails(page, "mount", `/${name}`) : mountRow(page, `/${name}`),
  ).toContainText(`/${root}`);
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
  await rowAction(page, "mount", `/${before}`, "Rename");
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
  await rowAction(page, "mount", `/${name}`, "Remove");

  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText(`Remove /${name}?`);
  await expect(confirmation).toContainText("Its files stay in the backend");
  await confirmation.getByRole("button", { name: "Remove mount" }).click();

  await expect(confirmation).toHaveCount(0);
  await expect(mountRow(page, `/${name}`)).toHaveCount(0);
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
  await rowAction(page, "mount", `/${name}`, "Move to another backend", "Move");
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

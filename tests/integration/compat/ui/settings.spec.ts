import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { boxOf, isNarrow, openList, shown, sidewaysOverflow } from "./helpers";
import { ADMIN, api, WORKERS_ORIGIN } from "./instances";

// The Settings scenarios about the sections, the profile, the appearance, the WebDAV address and
// the instance. Signing out has its tests in auth.spec.ts, since it ends a session; the ones about
// a wider side navigation and the name of the address field are in dashboard.spec.ts. A narrow
// page, as on a tablet or a phone, offers the sections in a selector instead of the section list.

const sectionList = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });

const sectionSelector = (page: Page) => page.getByRole("combobox", { name: "Section" });

/** Checks that the selector of sections ends above the heading of the section that is open. */
const expectSelectorAbove = async (page: Page, section: string) => {
  const selector = await boxOf(sectionSelector(page));
  const heading = await boxOf(page.getByRole("heading", { level: 2, name: section }));
  expect(selector.y + selector.height).toBeLessThanOrEqual(heading.y);
};

/** Checks the section the page marks as open: in the section list, or in the selector. */
const expectCurrent = async (page: Page, section: string) => {
  if (isNarrow(page)) {
    await expect(sectionSelector(page)).toHaveText(section);
    await expect(sectionList(page)).toHaveCount(0);
    return;
  }
  const current = sectionList(page).locator('li[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(section);
};

/** Opens the selector of sections and chooses one. */
const chooseSection = async (page: Page, name: string) => {
  await openList(page, "combobox", "Section", page);
  await page.getByRole("option", { name, exact: true }).click();
};

/** The labels and values of the open section's details. */
const factsOf = (page: Page) =>
  page.getByRole("main").evaluate((main) =>
    [...main.querySelectorAll("dt")].map((term) => ({
      label: term.textContent?.trim() ?? "",
      value: term.nextElementSibling?.textContent?.trim() ?? "",
    })),
  );

test("Opening a section by its address: the WebDAV section shows and the section list marks WebDAV as current", async ({
  page,
}) => {
  await page.goto("/settings?section=webdav");
  await shown(page.getByRole("heading", { level: 2, name: "WebDAV" }));
  await expect(page.getByRole("heading", { level: 2, name: "Profile" })).toHaveCount(0);
  await expectCurrent(page, "WebDAV");
});

test("The sections on offer: every section the instance can fill, Storage among them", async ({
  page,
}) => {
  await page.goto("/settings");
  if (isNarrow(page)) {
    await openList(page, "combobox", "Section", page);
  }
  const sections = isNarrow(page) ? page.getByRole("option") : sectionList(page).getByRole("link");
  await expect(sections).toHaveText([
    "Profile",
    "Sign-in and security",
    "Appearance",
    "WebDAV",
    "Storage",
    "Data export",
    "About this instance",
  ]);
});

test("An unknown section: billing opens the Profile section, which holds the owner's display name, username and email", async ({
  page,
}) => {
  await page.goto("/settings?section=billing");
  await shown(page.getByRole("heading", { level: 2, name: "Profile" }));
  const main = page.getByRole("main");
  await expect(main.getByRole("textbox", { name: "Display name" })).toHaveValue(ADMIN.name);
  await expect(main.getByRole("textbox", { name: "Username" })).toHaveValue(ADMIN.username);
  await expect(main.getByRole("textbox", { name: /^Email/ })).toHaveValue(ADMIN.email);
  await shown(main.getByRole("button", { name: "Save profile" }));
  await expectCurrent(page, "Profile");
});

// It and the next test set a window of their own, so the tablet and phone projects skip them.
test(
  "A phone-sized window: the selector shows WebDAV, choosing Appearance shows the Appearance section, and nothing scrolls sideways",
  { tag: "@desktop" },
  async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/settings?section=webdav");
    const selector = sectionSelector(page);
    await expect(selector).toHaveText("WebDAV");
    await shown(page.getByRole("heading", { level: 2, name: "WebDAV" }));
    await expect(sectionList(page)).toHaveCount(0);
    await expectSelectorAbove(page, "WebDAV");

    await chooseSection(page, "Appearance");
    await shown(page.getByRole("heading", { level: 2, name: "Appearance" }));
    await expect(selector).toHaveText("Appearance");
    await expect(sectionList(page)).toHaveCount(0);
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
  },
);

test(
  "A tablet-sized window: a selector above the section shows WebDAV in place of the section list, and nothing scrolls sideways",
  { tag: "@desktop" },
  async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/settings?section=webdav");
    await expect(sectionSelector(page)).toHaveText("WebDAV");
    await shown(page.getByRole("heading", { level: 2, name: "WebDAV" }));
    await expect(sectionList(page)).toHaveCount(0);
    await expectSelectorAbove(page, "WebDAV");
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
  },
);

test("The modes on offer: Appearance offers Light, Dark and System, with System selected", async ({
  page,
}) => {
  await page.goto("/settings?section=appearance");
  await expect(page.getByRole("radio")).toHaveCount(3);
  await expect(page.getByRole("radio", { name: "Light" })).not.toBeChecked();
  await expect(page.getByRole("radio", { name: "Dark" })).not.toBeChecked();
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
});

test("Connecting a client: the WebDAV section shows this instance's /dav/ address with Copy address, and says the password is an API key", async ({
  page,
}) => {
  await page.goto("/settings?section=webdav");
  await expect(page.getByRole("textbox", { name: "Address", exact: true })).toHaveValue(
    `${WORKERS_ORIGIN}/dav/`,
  );
  await shown(page.getByRole("button", { name: "Copy address" }));
  const facts = await factsOf(page);
  expect(facts).toEqual([
    { label: "Server", value: `${WORKERS_ORIGIN}/dav/` },
    { label: "Username", value: "Any name" },
    { label: "Password", value: "An API key" },
  ]);
  await expect(page.getByRole("main").getByRole("link", { name: "Credentials" })).toHaveAttribute(
    "href",
    "/credentials",
  );
});

test("Sign-in and security: the password, two-step verification, passkeys and this browser's session", async ({
  page,
}) => {
  await page.goto("/settings?section=security");
  await shown(page.getByRole("heading", { level: 2, name: "Sign-in and security" }));
  const main = page.getByRole("main");
  await shown(main.getByRole("button", { name: "Change password" }));
  // The owner of the test instance has not set up two-step verification.
  await shown(main.getByRole("button", { name: "Set up", exact: true }));
  await expect(main.getByRole("button", { name: "Turn off" })).toHaveCount(0);
  await shown(main.getByRole("heading", { level: 3, name: "Passkeys" }));
  await shown(main.getByRole("button", { name: "Add passkey" }));
  await shown(main.getByRole("heading", { level: 3, name: "Sessions" }));
  await shown(main.getByRole("button", { name: "Sign out", exact: true }));

  // Change password asks for the current password and a new one, and Cancel changes nothing.
  await main.getByRole("button", { name: "Change password" }).click();
  const dialog = page.getByRole("dialog", { name: "Change password" });
  await shown(dialog.getByRole("textbox", { name: "Current password" }));
  await shown(dialog.getByRole("textbox", { name: "New password" }));
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("Storage: the default backend for new mounts is the saved one, and Save waits for a change", async ({
  page,
}) => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the API's own answer
  const settings = (await api(page.request, "GET", "/api/settings/storage")) as {
    defaultBackendId: string | null;
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the API's own answer
  const backends = (await api(page.request, "GET", "/api/backends")) as {
    id: string;
    name: string;
  }[];
  const saved = backends.find((backend) => backend.id === settings.defaultBackendId);
  const other = backends.find((backend) => backend.id !== settings.defaultBackendId);
  await page.goto("/settings?section=storage");
  await shown(page.getByRole("heading", { level: 2, name: "Storage" }));
  const selector = page.getByRole("combobox", { name: "Default backend for new mounts" });
  const save = page.getByRole("button", { name: "Save storage settings" });
  if (saved !== undefined) await expect(selector).toContainText(saved.name);
  await expect(save).toBeDisabled();
  if (other === undefined) return;

  // Saving would change where every other test's new mounts go, so the answer is the page's own.
  let sent: unknown;
  await page.route("**/api/settings/storage", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    sent = route.request().postDataJSON();
    return route.fulfill({ json: { defaultBackendId: other.id } });
  });
  await openList(page, "combobox", "Default backend for new mounts", page);
  await page.getByRole("option", { name: new RegExp(`^${other.name}`) }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await shown(page.getByText("Storage settings saved.").first());
  expect(sent).toEqual({ defaultBackendId: other.id });
});

test("About this instance: its version, how it runs, its address, its WebDAV address and the storage it runs on", async ({
  page,
}) => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the API's own answer
  const info = (await api(page.request, "GET", "/api/instance")) as {
    version: string;
    commit: string | null;
    runtime: string;
    deployment: string;
    region: string | null;
    database: string;
  };
  await page.goto("/settings?section=about");
  await shown(page.getByRole("heading", { level: 2, name: "About this instance" }));
  await expect
    .poll(async () => (await factsOf(page)).map(({ label }) => label))
    .toEqual([
      "Version",
      "Commit",
      "Deployment",
      "Runtime",
      "Database",
      "Region",
      "Address",
      "WebDAV address",
      "Storage",
      "Backends",
      "Mounts",
    ]);
  await expect
    .poll(async () => (await factsOf(page)).slice(0, 8))
    .toEqual([
      { label: "Version", value: info.version },
      { label: "Commit", value: info.commit?.slice(0, 12) ?? "Unknown" },
      { label: "Deployment", value: info.deployment },
      { label: "Runtime", value: info.runtime },
      { label: "Database", value: info.database },
      { label: "Region", value: info.region ?? "Unknown" },
      { label: "Address", value: WORKERS_ORIGIN },
      { label: "WebDAV address", value: `${WORKERS_ORIGIN}/dav/` },
    ]);
  // Other tests add backends of other kinds, so the storage names Durable Objects among them.
  await expect
    .poll(async () => (await factsOf(page)).find(({ label }) => label === "Storage")?.value)
    .toContain("Cloudflare Durable Objects");
});

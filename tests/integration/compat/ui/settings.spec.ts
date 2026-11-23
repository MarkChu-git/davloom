import { expect, test, type Page } from "@playwright/test";
import { boxOf, openList, shown, sidewaysOverflow } from "./helpers";
import { ADMIN, WORKERS_ORIGIN } from "./instances";

// The Settings scenarios about the sections, the profile, the appearance, the WebDAV address and
// the instance. Signing out has its tests in auth.spec.ts, since it ends a session; the ones about
// a wider side navigation and the name of the address field are in dashboard.spec.ts.

const sectionList = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });

const sectionSelector = (page: Page) => page.getByRole("combobox", { name: "Section" });

/** Checks that the selector of sections ends above the heading of the section that is open. */
const expectSelectorAbove = async (page: Page, section: string) => {
  const selector = await boxOf(sectionSelector(page));
  const heading = await boxOf(page.getByRole("heading", { level: 2, name: section }));
  expect(selector.y + selector.height).toBeLessThanOrEqual(heading.y);
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

  const current = sectionList(page).locator('li[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("WebDAV");
});

test("The sections on offer: only those the instance can fill, with no storage settings or data export yet", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(sectionList(page).getByRole("link")).toHaveText([
    "Profile",
    "Sign-in and security",
    "Appearance",
    "WebDAV",
    "About this instance",
  ]);
});

test("An unknown section: billing opens the Profile section, which names the administrator", async ({
  page,
}) => {
  await page.goto("/settings?section=billing");
  await shown(page.getByRole("heading", { level: 2, name: "Profile" }));
  await expect
    .poll(() => factsOf(page))
    .toEqual([
      { label: "Name", value: ADMIN.name },
      { label: "Email", value: ADMIN.email },
      { label: "Role", value: "Administrator" },
    ]);

  const current = sectionList(page).locator('li[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("Profile");
});

test("A phone-sized window: the selector shows WebDAV, choosing Appearance shows the Appearance section, and nothing scrolls sideways", async ({
  page,
}) => {
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
});

test("A tablet-sized window: a selector above the section shows WebDAV in place of the section list, and nothing scrolls sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/settings?section=webdav");
  await expect(sectionSelector(page)).toHaveText("WebDAV");
  await shown(page.getByRole("heading", { level: 2, name: "WebDAV" }));
  await expect(sectionList(page)).toHaveCount(0);
  await expectSelectorAbove(page, "WebDAV");
  expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
});

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

test("About this instance: its address, its WebDAV address and the storage it runs on", async ({
  page,
}) => {
  await page.goto("/settings?section=about");
  await shown(page.getByRole("heading", { level: 2, name: "About this instance" }));
  await expect
    .poll(async () => (await factsOf(page)).map(({ label }) => label))
    .toEqual(["Address", "WebDAV address", "Storage", "Backends", "Mounts"]);
  await expect
    .poll(async () => (await factsOf(page)).slice(0, 3))
    .toEqual([
      { label: "Address", value: WORKERS_ORIGIN },
      { label: "WebDAV address", value: `${WORKERS_ORIGIN}/dav/` },
      { label: "Storage", value: "Cloudflare Durable Objects" },
    ]);
});

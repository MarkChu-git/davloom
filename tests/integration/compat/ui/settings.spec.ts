import { expect, test, type Page } from "@playwright/test";
import {
  installClock,
  levelOne,
  onScreen,
  openList,
  shown,
  sideNavigation,
  sidewaysOverflow,
  stopTimers,
} from "./helpers";

// The Settings scenarios about the sections, the profile, the sessions, the appearance, the
// WebDAV address, the default backend, the export and the instance. The ones about a wider side
// navigation, folding it and a profile without a name have their tests in dashboard.spec.ts.

const sectionList = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });

const sectionSelector = (page: Page) => page.getByRole("combobox", { name: "Section" });

/** Opens the selector of sections and chooses one. */
const chooseSection = async (page: Page, name: string) => {
  await openList(page, "combobox", "Section", page);
  await page.getByRole("option", { name, exact: true }).click();
};

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

test("An unknown section: billing opens the Profile section", async ({ page }) => {
  await page.goto("/settings?section=billing");
  await shown(page.getByRole("heading", { level: 2, name: "Profile" }));
  await expect(page.getByRole("textbox", { name: "Display name" })).toBeVisible();

  const current = sectionList(page).locator('li[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("Profile");
});

test("A phone-sized window: the selector shows WebDAV, choosing Storage shows the Storage section, and nothing scrolls sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/settings?section=webdav");
  const selector = sectionSelector(page);
  await expect(selector).toHaveText("WebDAV");
  await shown(page.getByRole("heading", { level: 2, name: "WebDAV" }));
  await expect(sectionList(page)).toHaveCount(0);

  await chooseSection(page, "Storage");
  await shown(page.getByRole("heading", { level: 2, name: "Storage" }));
  await expect(selector).toHaveText("Storage");
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
  expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
});

test("Autofill purposes: the display name field declares name and the email field declares email", async ({
  page,
}) => {
  await page.goto("/settings?section=profile");
  await expect(page.getByRole("textbox", { name: "Display name" })).toHaveAttribute(
    "autocomplete",
    "name",
  );
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "autocomplete",
    "email",
  );
});

test("Saving the profile: Home admin is still the display name after opening Overview and coming back", async ({
  page,
}) => {
  await page.goto("/settings?section=profile");
  await page.getByRole("textbox", { name: "Display name" }).fill("Home admin");
  await page.getByRole("button", { name: "Save profile" }).click();

  // The profile lasts for the visit, so Profile is reached again from inside the page, since a
  // reload would bring the sample back.
  await sideNavigation(page).getByRole("link", { name: "Overview" }).click();
  await expect(levelOne(page)).toHaveText("Overview");
  await sideNavigation(page).getByRole("link", { name: "Settings" }).click();
  await expect(levelOne(page)).toHaveText("Settings");
  await expect(page.getByRole("textbox", { name: "Display name" })).toHaveValue("Home admin");
});

test("Signing out another session: Firefox on Windows leaves the list, and the current session offers no sign-out", async ({
  page,
}) => {
  await page.goto("/settings?section=security");
  await shown(page.getByText("Safari on macOS", { exact: true }));
  // Only the other session can be signed out.
  const signOut = page.getByRole("button", { name: /^Sign out/ });
  await expect(signOut).toHaveText("Sign out");
  await expect(signOut).toHaveCount(1);
  await expect(signOut).toHaveAccessibleName("Sign out Firefox on Windows");

  await signOut.click();
  await expect(page.getByText("Firefox on Windows", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Sign out/ })).toHaveCount(0);
  await expect(page.getByText("Safari on macOS", { exact: true })).toBeVisible();
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

test("Connecting a client: the WebDAV section shows https://files.example.com/dav/ with Copy address", async ({
  page,
}) => {
  await page.goto("/settings?section=webdav");
  await expect(page.getByRole("textbox", { name: "Address", exact: true })).toHaveValue(
    "https://files.example.com/dav/",
  );
  await shown(page.getByRole("button", { name: "Copy address" }));
});

test("A new default: after R2 photos is saved as the default backend, the form for a new mount starts with R2 photos", async ({
  page,
}) => {
  await page.goto("/settings?section=storage");
  const backend = page.getByRole("combobox", { name: "Default backend for new mounts" });
  await expect(backend).toHaveText("Durable Objects");
  await openList(page, "combobox", "Default backend for new mounts", page);
  await page.getByRole("option", { name: "R2 photos", exact: true }).click();
  await expect(backend).toHaveText("R2 photos");
  await page.getByRole("button", { name: "Save storage settings" }).click();

  // The choice lasts for the visit, so Storage & Mounts is reached from inside the page.
  await sideNavigation(page)
    .getByRole("link", { name: /^Storage & Mounts/ })
    .click();
  await page.getByRole("button", { name: "Add mount" }).click();
  await expect(page.getByRole("dialog").getByRole("combobox", { name: /^Backend/ })).toContainText(
    "R2 photos",
  );
});

test("Exporting: the button shows the export running, then a notification names davloom-export-2026-11-16.json", async ({
  page,
}) => {
  await installClock(page);
  await stopTimers(page);
  await page.goto("/settings?section=export");
  const button = page.getByRole("button", { name: "Export", exact: true });
  await shown(button);

  await button.click();
  await expect(button).toHaveAttribute("aria-busy", "true");

  // The export ends after a short pause, as it would while the data is gathered.
  await page.clock.runFor(1000);
  await expect(button).not.toHaveAttribute("aria-busy", "true");
  await shown(onScreen(page, "Exported davloom-export-2026-11-16.json."));
});

test("The sample instance: About this instance shows the deployment Cloudflare Free, the runtime Cloudflare Workers and the database Cloudflare D1", async ({
  page,
}) => {
  await page.goto("/settings?section=about");
  await shown(page.getByRole("heading", { level: 2, name: "About this instance" }));
  const facts = await page.getByRole("main").evaluate((main) =>
    [...main.querySelectorAll("dt")].map((term) => ({
      label: term.textContent?.trim() ?? "",
      value: term.nextElementSibling?.textContent?.trim() ?? "",
    })),
  );
  expect(facts.map(({ label }) => label)).toEqual([
    "Name",
    "Version",
    "Commit",
    "Deployment",
    "Runtime",
    "Database",
    "Region",
    "WebDAV address",
  ]);
  const valueOf = (label: string) => facts.find((fact) => fact.label === label)?.value;
  expect(valueOf("Deployment")).toBe("Cloudflare Free");
  expect(valueOf("Runtime")).toBe("Cloudflare Workers");
  expect(valueOf("Database")).toBe("Cloudflare D1");
});

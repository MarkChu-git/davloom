import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { isNarrow, levelOne, navigationLinks, openList, shown } from "./helpers";
import { ADMIN } from "./instances";

// The core flows of finding one's way (PRD §11): reaching each page from the navigation and by its
// address, coming back to it after a reload or a sign-in, and opening each Settings section. They
// run in every browser at every size, so each step goes through the layout the window has: the
// side navigation or the Menu button, the section list or its selector.

const PAGES = [
  { path: "/", name: "Overview" },
  { path: "/files", name: "Files" },
  { path: "/credentials", name: "Credentials" },
  { path: "/storage", name: "Storage & Mounts" },
  { path: "/settings", name: "Settings" },
] as const;

/** The Settings sections in list order, by `?section=` and by name (features/settings/sections.ts). */
const SECTIONS = [
  { id: "profile", name: "Profile" },
  { id: "security", name: "Sign-in and security" },
  { id: "activity", name: "Activity" },
  { id: "appearance", name: "Appearance" },
  { id: "webdav", name: "WebDAV" },
  { id: "storage", name: "Storage" },
  { id: "export", name: "Data export" },
  { id: "about", name: "About this instance" },
] as const;

/** Waits for the page called `name`: its heading and the window's title. */
const expectPage = async (page: Page, name: string) => {
  await expect(levelOne(page)).toHaveText(name);
  await expect(page).toHaveTitle(`${name} | Davloom`);
};

/** The section of Settings that is open: its heading, and the list or selector marking it. */
const expectSection = async (page: Page, name: string) => {
  await shown(page.getByRole("heading", { level: 2, name, exact: true }));
  if (isNarrow(page)) {
    await expect(page.getByRole("combobox", { name: "Section" })).toHaveText(name);
    return;
  }
  const current = page
    .getByRole("navigation", { name: "Settings sections" })
    .locator('li[aria-current="true"]');
  await expect(current).toHaveText(name);
};

for (const [index, { path, name }] of PAGES.entries()) {
  // From the page before it in the list, so that every link is followed once.
  const from = PAGES[(index + PAGES.length - 1) % PAGES.length] ?? PAGES[0];

  test(`Reaching ${name} from the navigation: the link opens it from ${from.name} and marks it as the current page`, async ({
    page,
  }) => {
    await page.goto(from.path);
    await expectPage(page, from.name);
    const links = await navigationLinks(page);
    await links.getByRole("link", { name, exact: true }).click();
    await expectPage(page, name);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(
      (await navigationLinks(page)).getByRole("link", { name, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test(`Reloading ${name}: the page comes back at its address, signed in`, async ({ page }) => {
    await page.goto(path);
    await expectPage(page, name);
    await page.reload();
    await expectPage(page, name);
    expect(new URL(page.url()).pathname).toBe(path);
  });
}

for (const [index, { id, name }] of SECTIONS.entries()) {
  test(`Opening ${name} by its address: ?section=${id} shows the section and marks it as current`, async ({
    page,
  }) => {
    await page.goto(`/settings?section=${id}`);
    await expectPage(page, "Settings");
    await expectSection(page, name);
  });

  // From the section before it, so that every section is chosen once.
  const from = SECTIONS[(index + SECTIONS.length - 1) % SECTIONS.length] ?? SECTIONS[0];

  test(`Choosing ${name}: from ${from.name}, the section list or the selector opens it and puts it in the address`, async ({
    page,
  }) => {
    await page.goto(`/settings?section=${from.id}`);
    await expectSection(page, from.name);
    if (isNarrow(page)) {
      await openList(page, "combobox", "Section", page);
      await page.getByRole("option", { name, exact: true }).click();
    } else {
      await page
        .getByRole("navigation", { name: "Settings sections" })
        .getByRole("link", { name, exact: true })
        .click();
    }
    await expectSection(page, name);
    await expect(page).toHaveURL(new RegExp(`[?&]section=${id}(&|$)`));
  });
}

test.describe("without a session", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const { path, name } of PAGES) {
    test(`Signing in on the way to ${name}: the sign-in page keeps ${path} and opens it once signed in`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(levelOne(page)).toHaveText("Sign in");
      expect(new URL(page.url()).searchParams.get("redirect") ?? "/").toBe(path);
      await page.getByRole("textbox", { name: "Username or email" }).fill(ADMIN.username);
      await page.getByLabel("Password").fill(ADMIN.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expectPage(page, name);
      expect(new URL(page.url()).pathname).toBe(path);
    });
  }
});

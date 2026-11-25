import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { backgroundOf } from "./colors";
import { isPhone, levelOne, shown } from "./helpers";

// The core flows of the owner's preferences in Settings > Appearance (PRD §11): the color mode and
// the language, chosen on the page, kept after a reload, and carried to every other page. Each
// test's browser starts without a stored choice.

const appearance = (page: Page) => page.getByRole("radiogroup", { name: /^(Appearance|外观)$/ });
const language = (page: Page) => page.getByRole("radiogroup", { name: /^(Language|语言)$/ });

/** The mode the page shows: what `data-theme` on <html> names, or none while it follows System. */
const themeOf = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));

/** The navigation's links in Chinese: the side navigation, or on a phone the Menu's dropdown. */
const chineseNavigation = async (page: Page) => {
  if (!isPhone(page)) return page.getByRole("navigation", { name: "侧边导航" });
  await page.getByRole("button", { name: "菜单" }).click();
  const dropdown = page.getByRole("dialog", { name: "菜单" });
  await shown(dropdown);
  return dropdown;
};

/** The page's background, which each mode colors differently. */
const bodyColor = (page: Page) => backgroundOf(page.locator("body"));

/** The scheme the page's colors follow, as the browser resolves it. */
const schemeOf = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

for (const mode of ["Light", "Dark"] as const) {
  // The other mode is the one the operating system asks for, so the choice is what changes it.
  const system = mode === "Light" ? "dark" : "light";

  test(`Choosing ${mode}: the page turns ${mode.toLowerCase()} over the system's ${system} scheme at once, and stays so after a reload`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.goto("/settings?section=appearance");
    await appearance(page).getByRole("radio", { name: mode }).click();
    await expect.poll(() => themeOf(page)).toBe(mode.toLowerCase());
    expect(await schemeOf(page)).toContain(mode.toLowerCase());

    await page.reload();
    await expect(appearance(page).getByRole("radio", { name: mode })).toBeChecked();
    expect(await themeOf(page)).toBe(mode.toLowerCase());
  });
}

test("Choosing System after Dark: the page follows the operating system's scheme again, as it changes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings?section=appearance");
  const light = await bodyColor(page);
  await appearance(page).getByRole("radio", { name: "Dark" }).click();
  await expect.poll(() => themeOf(page)).toBe("dark");
  await expect.poll(() => bodyColor(page)).not.toBe(light);
  const dark = await bodyColor(page);

  await appearance(page).getByRole("radio", { name: "System" }).click();
  await expect.poll(() => bodyColor(page)).toBe(light);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => bodyColor(page)).toBe(dark);
  await page.reload();
  await expect(appearance(page).getByRole("radio", { name: "System" })).toBeChecked();
  await expect.poll(() => bodyColor(page)).toBe(dark);
});

test.describe("in a browser that prefers English", () => {
  test.use({ locale: "en-US" });

  test("Choosing 简体中文: Settings speaks Chinese at once and after a reload", async ({
    page,
  }) => {
    await page.goto("/settings?section=appearance");
    await language(page).getByRole("radio", { name: "简体中文" }).click();
    await expect(levelOne(page)).toHaveText("设置");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await page.reload();
    await expect(levelOne(page)).toHaveText("设置");
    await expect(language(page).getByRole("radio", { name: "简体中文" })).toBeChecked();
  });

  const PAGES = [
    { path: "/", heading: "概览" },
    { path: "/files", heading: "文件" },
    { path: "/credentials", heading: "凭据" },
    { path: "/storage", heading: "存储与挂载" },
    { path: "/settings", heading: "设置" },
  ] as const;

  for (const { path, heading } of PAGES) {
    test(`Chinese carries to ${heading}: once chosen, the navigation leads to ${path} in Chinese`, async ({
      page,
    }) => {
      await page.goto("/settings?section=appearance");
      await language(page).getByRole("radio", { name: "简体中文" }).click();
      await expect(levelOne(page)).toHaveText("设置");
      // From Overview, so that the link to Settings is followed too.
      if (path === "/settings") {
        await (
          await chineseNavigation(page)
        )
          .getByRole("link", { name: "概览", exact: true })
          .click();
        await expect(levelOne(page)).toHaveText("概览");
      }
      await (
        await chineseNavigation(page)
      )
        .getByRole("link", { name: heading, exact: true })
        .click();
      await expect(levelOne(page)).toHaveText(heading);
      await expect(page).toHaveTitle(`${heading} | Davloom`);
      expect(new URL(page.url()).pathname).toBe(path);
    });
  }
});

test.describe("in a browser that prefers Chinese", () => {
  test.use({ locale: "zh-CN" });

  test("Choosing English: Settings speaks English at once and after a reload", async ({ page }) => {
    await page.goto("/settings?section=appearance");
    await expect(levelOne(page)).toHaveText("设置");
    await language(page).getByRole("radio", { name: "English" }).click();
    await expect(levelOne(page)).toHaveText("Settings");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(levelOne(page)).toHaveText("Settings");
    await expect(language(page).getByRole("radio", { name: "English" })).toBeChecked();
  });
});

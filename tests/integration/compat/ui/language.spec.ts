import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { axeViolations } from "./axe";
import { levelOne, placeholderRows, sidewaysOverflow } from "./helpers";

// The Dashboard in Simplified Chinese: chosen from the browser's languages or in Settings >
// Appearance, shown from the first paint, and the same in every open tab.

interface ChinesePage {
  readonly path: string;
  readonly title: string;
  /** The page's heading in Chinese, and in English, which it must not show. */
  readonly heading: string;
  readonly english: string;
}

const PAGES: readonly ChinesePage[] = [
  { path: "/", title: "概览 | Davloom", heading: "概览", english: "Overview" },
  { path: "/files", title: "文件 | Davloom", heading: "文件", english: "Files" },
  { path: "/credentials", title: "凭据 | Davloom", heading: "凭据", english: "Credentials" },
  {
    path: "/storage",
    title: "存储与挂载 | Davloom",
    heading: "存储与挂载",
    english: "Storage & Mounts",
  },
  { path: "/settings", title: "设置 | Davloom", heading: "设置", english: "Settings" },
];

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang);

/** The text the page shows, without the parts the stylesheet hides. */
const shownText = (page: Page) => page.evaluate(() => document.body.innerText);

test.describe("a browser that prefers Chinese", () => {
  test.use({ locale: "zh-CN" });

  for (const { path, title, heading, english } of PAGES) {
    test(`shows ${path} in Chinese`, async ({ page }) => {
      await page.goto(path);
      await expect(levelOne(page)).toHaveText(heading);
      await expect(page).toHaveTitle(title);
      expect(await htmlLang(page)).toBe("zh-CN");
      const navigation = page.getByRole("navigation").first();
      await expect(navigation).not.toContainText(english);
      expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
    });

    test(`paints ${path} in Chinese before any app code runs`, async ({ page }) => {
      // With the bundles blocked, only what the HTML itself carries can affect the page.
      await page.route("**/assets/*.js", (route) => route.abort());
      await page.goto(path, { waitUntil: "load" });
      expect(await htmlLang(page)).toBe("zh-CN");
      await expect(page).toHaveTitle(title);
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description?.replaceAll(/Davloom|WebDAV|API/g, "")).not.toMatch(/[A-Za-z]{3}/);
      const text = await shownText(page);
      expect(text).toContain(heading);
      expect(text).not.toContain(english);
    });
  }

  test("signs in and creates an account in Chinese, from the first paint @desktop", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      locale: "zh-CN",
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    for (const [path, heading] of [
      ["/sign-in", "登录"],
      ["/register", "创建账户"],
    ] as const) {
      await page.route("**/assets/*.js", (route) => route.abort());
      await page.goto(path, { waitUntil: "load" });
      expect(await htmlLang(page)).toBe("zh-CN");
      expect(await shownText(page)).toContain(heading);
      await page.unrouteAll();
    }
    await page.goto("/sign-in");
    await expect(levelOne(page)).toHaveText("登录");
    await expect(page.getByRole("textbox", { name: "用户名或电子邮件" })).toBeVisible();
    await context.close();
  });

  test("passes the accessibility audit in Chinese @desktop", async ({ page }) => {
    for (const { path, heading } of PAGES) {
      await page.goto(path);
      await expect(levelOne(page)).toHaveText(heading);
      // The audit looks at the page as it stands once its reads have answered.
      await expect(placeholderRows(page)).toHaveCount(0);
      expect(await axeViolations(page), path).toEqual([]);
    }
  });
});

/** The language control of Settings > Appearance, named in either language. */
const language = (page: Page) => page.getByRole("radiogroup", { name: /^(Language|语言)$/ });

test.describe("the language in Settings", () => {
  test.use({ locale: "en-US" });

  test("switches the page at once, stays after a reload, and follows in another tab @desktop", async ({
    page,
    context,
  }) => {
    const other = await context.newPage();
    await other.goto("/credentials");
    await expect(levelOne(other)).toHaveText("Credentials");

    await page.goto("/settings?section=appearance");
    await expect(levelOne(page)).toHaveText("Settings");
    await language(page).getByRole("radio", { name: "简体中文" }).click();

    await expect(levelOne(page)).toHaveText("设置");
    expect(await htmlLang(page)).toBe("zh-CN");
    await expect(levelOne(other)).toHaveText("凭据");
    expect(await htmlLang(other)).toBe("zh-CN");

    // The first paint after a reload is Chinese already.
    await page.route("**/assets/*.js", (route) => route.abort());
    await page.reload({ waitUntil: "load" });
    expect(await htmlLang(page)).toBe("zh-CN");
    await expect(page).toHaveTitle("设置 | Davloom");
    await page.unrouteAll();
    await page.reload();
    await expect(language(page).getByRole("radio", { name: "简体中文" })).toBeChecked();

    // System follows the browser again, which prefers English.
    await language(page).getByRole("radio", { name: "跟随系统" }).click();
    await expect(levelOne(page)).toHaveText("Settings");
    await expect(levelOne(other)).toHaveText("Credentials");
    expect(await htmlLang(page)).toBe("en");
  });
});

import { expect, test } from "@playwright/test";
import { BRAND_DARK, BRAND_LIGHT, backgroundOf } from "./colors";

const markColor = (page: import("@playwright/test").Page) =>
  backgroundOf(page.getByTestId("brand-mark"));
const bodyColor = (page: import("@playwright/test").Page) => backgroundOf(page.locator("body"));

test("the default mode is System", async ({ page }) => {
  await page.goto("/design-check");

  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
});

test("choosing Dark applies at once", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-check");
  expect(await markColor(page)).toBe(BRAND_LIGHT);

  await page.getByRole("radio", { name: "Dark" }).click();

  expect(await markColor(page)).toBe(BRAND_DARK);
});

test("the choice survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-check");
  await page.getByRole("radio", { name: "Dark" }).click();

  await page.reload();

  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  expect(await markColor(page)).toBe(BRAND_DARK);
});

test("the first paint after a reload is already dark, before any app code runs", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-check");
  const lightBody = await bodyColor(page);
  await page.getByRole("radio", { name: "Dark" }).click();
  const darkBody = await bodyColor(page);
  expect(darkBody).not.toBe(lightBody);

  // With the bundles blocked, only what the HTML itself carries can affect the page.
  await page.route("**/assets/*.js", (route) => route.abort());
  await page.reload();

  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  expect(await bodyColor(page)).toBe(darkBody);
});

test("System follows the operating system without a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-check");
  expect(await markColor(page)).toBe(BRAND_LIGHT);

  await page.emulateMedia({ colorScheme: "dark" });

  expect(await markColor(page)).toBe(BRAND_DARK);
});

test("Light overrides a dark operating system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/design-check");

  await page.getByRole("radio", { name: "Light" }).click();

  expect(await markColor(page)).toBe(BRAND_LIGHT);
});

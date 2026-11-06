import { expect, test } from "@playwright/test";
import { brandTokens } from "@davloom/ui/tokens/brand";
import { BRAND_DARK, BRAND_LIGHT, backgroundOf, rgb } from "./colors";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-check");
});

test("the design system and our own component both resolve their styles", async ({ page }) => {
  const button = page.getByRole("button", { name: "Primary action" });
  const mark = page.getByTestId("brand-mark");

  await expect.poll(() => backgroundOf(button)).toBe(BRAND_LIGHT);
  expect(await backgroundOf(mark)).toBe(BRAND_LIGHT);
  expect(await mark.evaluate((node) => getComputedStyle(node).fontWeight)).toBe("600");
  expect(await mark.evaluate((node) => getComputedStyle(node).color)).toBe(
    rgb(brandTokens.onAccent[0]),
  );
});

test("switching to dark changes the design system and our own component together", async ({
  page,
}) => {
  const button = page.getByRole("button", { name: "Primary action" });
  const mark = page.getByTestId("brand-mark");

  await page.getByRole("radio", { name: "Dark" }).click();

  // The design system animates its background color, so wait for the transition to finish.
  await expect.poll(() => backgroundOf(button)).toBe(BRAND_DARK);
  expect(await backgroundOf(mark)).toBe(BRAND_DARK);
});

import { expect, test } from "@playwright/test";

// Throwaway: fails on purpose, to show what the "Print the Playwright failure context" step prints.
for (let n = 1; n <= 6; n += 1) {
  test(`probe ${n}: a failing test shows what the runner discards`, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "No such heading" })).toBeVisible({
      timeout: 1500,
    });
  });
}

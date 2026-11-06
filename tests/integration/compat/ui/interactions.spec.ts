import { expect, test } from "@playwright/test";

const problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems.length = 0;
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(message.text());
    }
  });
  await page.goto("/design-check");
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test("Dialog opens and closes from the keyboard and gives focus back", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Open dialog" });

  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Menu opens, moves and closes from the keyboard and gives focus back", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Actions" });

  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("choosing a menu item runs it", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Actions" });

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("last-action")).toHaveText("Rename");
  await expect(trigger).toBeFocused();
});

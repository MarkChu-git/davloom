import { expect, test } from "@playwright/test";

// Bun serves the Dashboard but runs no management API yet (self-hosting is the next milestone).
// The Dashboard says so rather than showing an empty page.

test("A server without the API: the Dashboard says it cannot open and offers Try again", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Davloom cannot open the Dashboard")).toBeVisible();
  await expect(page.getByText("This server does not run the management API yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Sign-in without the API: the form shows, with a warning that the API is missing", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByText("This server does not run the management API yet.")).toBeVisible();
});

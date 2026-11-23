import { expect, test } from "@playwright/test";

// This Bun server runs without DAVLOOM_SECRET, so its API answers that it is not configured. The
// Dashboard says so rather than showing an empty page.

test("A server that is not configured: the Dashboard says it cannot open and offers Try again", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Davloom cannot open the Dashboard")).toBeVisible();
  await expect(page.getByText(/This instance is not configured/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Sign-in on a server that is not configured: the form shows, with a warning", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByText(/This instance is not configured/)).toBeVisible();
});

import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { axeViolations } from "./axe";
import { levelOne, onlyInChromium, onScreen, shown } from "./helpers";

// The accessibility audit of the pages a person sees before signing in: sign-in, its second step
// and Create account, in light and dark mode. dashboard.spec.ts audits every signed-in page state
// the same way.
test.use({ storageState: { cookies: [], origins: [] } });

/** Answers GET /api/registration as an instance that has no owner yet. */
const freshInstance = (page: Page, refusal?: { status: number; json: unknown }) =>
  page.route("**/api/registration", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { open: true } })
      : route.fulfill(refusal ?? { status: 500, json: {} }),
  );

/** Answers a password sign-in as an account with two-step verification does. */
const secondStep = (page: Page) =>
  page.route("**/api/auth/sign-in/username", (route) =>
    route.fulfill({ json: { twoFactorRedirect: true } }),
  );

const identifier = (page: Page) => page.getByRole("textbox", { name: "Username or email" });
const newPassword = (page: Page) => page.locator('input[autocomplete="new-password"]');

interface SignedOutState {
  readonly name: string;
  readonly path: string;
  readonly before?: (page: Page) => Promise<unknown>;
  readonly show: (page: Page) => Promise<void>;
}

const STATES: readonly SignedOutState[] = [
  {
    name: "Sign in",
    path: "/sign-in",
    show: (page) => expect(levelOne(page)).toHaveText("Sign in"),
  },
  {
    name: "Sign in with empty fields",
    path: "/sign-in",
    show: async (page) => {
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(identifier(page)).toHaveAttribute("aria-invalid", "true");
    },
  },
  {
    name: "Sign in with a wrong password",
    path: "/sign-in",
    show: async (page) => {
      await identifier(page).fill("admin");
      await page.getByLabel("Password").fill("not the password at all");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await shown(onScreen(page, /wrong/));
    },
  },
  {
    name: "Sign in, second step",
    path: "/sign-in",
    before: (page) => secondStep(page),
    show: async (page) => {
      await identifier(page).fill("admin");
      await page.getByLabel("Password").fill("a long enough password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(levelOne(page)).toHaveText("Two-step verification");
      await page.getByRole("button", { name: "Verify" }).click();
      await shown(onScreen(page, "Enter the code from your authenticator app."));
    },
  },
  {
    name: "Create account",
    path: "/register",
    before: (page) => freshInstance(page),
    show: (page) => expect(levelOne(page)).toHaveText("Create account"),
  },
  {
    name: "Create account with field errors",
    path: "/register",
    before: (page) => freshInstance(page),
    show: async (page) => {
      await page.getByRole("textbox", { name: /^Email/ }).fill("nope");
      await newPassword(page).fill("short");
      await page.getByRole("button", { name: "Create account" }).click();
      await shown(onScreen(page, "Use at least 12 characters."));
    },
  },
  {
    name: "Create account with a generated password and a refusal",
    path: "/register",
    before: (page) =>
      freshInstance(page, {
        status: 400,
        json: {
          error: {
            code: "password_refused",
            message: "This password appears in known data breaches. Choose another.",
          },
        },
      }),
    show: async (page) => {
      await page.getByRole("textbox", { name: "Username" }).fill("owner");
      await page.getByRole("button", { name: "Generate" }).click();
      await shown(page.getByRole("button", { name: "Copy" }));
      await page.getByRole("button", { name: "Create account" }).click();
      await shown(onScreen(page, /known data breaches/));
    },
  },
  {
    name: "Create account from an export",
    path: "/register",
    before: (page) => freshInstance(page),
    show: async (page) => {
      await page.getByRole("radio", { name: "From an export" }).click();
      await shown(page.getByRole("button", { name: "Import" }));
    },
  },
];

for (const scheme of ["light", "dark"] as const) {
  for (const { name, path, before, show } of STATES) {
    test(`Accessibility: ${name} has no axe-core violation in ${scheme} mode`, async ({ page }) => {
      onlyInChromium("The accessibility audit runs in desktop Chromium.");
      await page.emulateMedia({ colorScheme: scheme });
      await before?.(page);
      await page.goto(path);
      await show(page);
      // The theme painted the mode the audit is for: a dark body in dark mode, a light one in light.
      const red = await page.evaluate(() =>
        Number(getComputedStyle(document.body).backgroundColor.match(/[\d.]+/)?.[0] ?? 255),
      );
      expect(red < 128).toBe(scheme === "dark");

      expect(await axeViolations(page)).toEqual([]);
    });
  }
}

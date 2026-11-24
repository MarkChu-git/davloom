import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "./axe";
import { levelOne, onlyInChromium, onScreen, shown } from "./helpers";

// The accessibility audit of the pages a person sees before signing in: sign-in and first-run
// setup, in light and dark mode. dashboard.spec.ts audits every signed-in page state the same way.
test.use({ storageState: { cookies: [], origins: [] } });

/** Answers GET /api/setup as an instance that has no administrator yet. */
const freshInstance = (page: Page, { open = true, refusal = "" } = {}) =>
  page.route("**/api/setup", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { needed: true, open } })
      : route.fulfill({ status: 403, json: { error: { code: refusal } } }),
  );

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
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    },
  },
  {
    name: "Sign in with a wrong password",
    path: "/sign-in",
    show: async (page) => {
      await page.getByRole("textbox", { name: "Email" }).fill("admin@example.com");
      await page.getByLabel("Password").fill("not the password at all");
      await page.getByRole("button", { name: "Sign in" }).click();
      await shown(onScreen(page, /wrong/));
    },
  },
  {
    name: "Setup",
    path: "/setup",
    before: (page) => freshInstance(page),
    show: (page) => expect(levelOne(page)).toHaveText("Set up Davloom"),
  },
  {
    name: "Setup with field errors",
    path: "/setup",
    before: (page) => freshInstance(page, { refusal: "setup_token_invalid" }),
    show: async (page) => {
      await page.getByRole("textbox", { name: "Name" }).fill("Owner");
      await page.getByRole("textbox", { name: "Email" }).fill("owner@example.com");
      await page.getByLabel("Password", { exact: true }).fill("short");
      await page.getByLabel("Setup token").fill("token");
      await page.getByRole("button", { name: "Create administrator" }).click();
      await shown(onScreen(page, "Use at least 12 characters."));
    },
  },
  {
    name: "Setup with a wrong token",
    path: "/setup",
    before: (page) => freshInstance(page, { refusal: "setup_token_invalid" }),
    show: async (page) => {
      await page.getByRole("textbox", { name: "Name" }).fill("Owner");
      await page.getByRole("textbox", { name: "Email" }).fill("owner@example.com");
      await page.getByLabel("Password", { exact: true }).fill("a long enough password");
      await page.getByLabel("Setup token").fill("token");
      await page.getByRole("button", { name: "Create administrator" }).click();
      await shown(onScreen(page, /The setup token is wrong/));
    },
  },
  {
    name: "Setup from an export",
    path: "/setup",
    before: (page) => freshInstance(page),
    show: async (page) => {
      await page.getByRole("radio", { name: "From an export" }).click();
      await shown(page.getByRole("button", { name: "Import" }));
    },
  },
  {
    name: "Setup that is closed",
    path: "/setup",
    before: (page) => freshInstance(page, { open: false }),
    show: (page) => shown(onScreen(page, "Setup is closed")),
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

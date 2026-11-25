import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { levelOne, placeholderRows, shown } from "./helpers";
import { showScreenData, type ScreenOptions } from "./screens";

// Screenshot regression (PRD §11): 15 key screens of the Dashboard, each in light and dark mode,
// compared with the baselines in __screenshots__ by the three `screenshots-*` projects, desktop,
// tablet and phone in Chromium, each of what the window shows. The data, the clock and the animations are fixed (screens.ts), so
// a difference is a change to how a screen looks. The baselines are taken in the CI job's own
// Playwright image, since another machine's fonts and rendering differ; docs/ci.md says how to
// make them again, and a baseline changes only in a pull request that shows the old and the new.

interface Screen {
  readonly name: string;
  readonly path: string;
  readonly options?: ScreenOptions;
  /** What the screen shows once it is ready, after its reads have answered. */
  readonly ready: (page: Page) => Promise<void>;
}

/**
 * What shows the server's own address, such as the WebDAV address field: its port moves with
 * DAVLOOM_UI_PORT_BASE, so the screenshots cover it with a box of one color.
 */
const origin = (page: Page) => {
  const { host } = new URL(page.url());
  return page.locator(`input[value*="${host}"]`).or(page.getByText(host));
};

const heading = (name: string) => (page: Page) => expect(levelOne(page)).toHaveText(name);

const section = (name: string) => async (page: Page) => {
  await expect(levelOne(page)).toHaveText("Settings");
  await shown(page.getByRole("heading", { level: 2, name, exact: true }));
};

const SCREENS: readonly Screen[] = [
  { name: "sign-in", path: "/sign-in", options: { signedIn: false }, ready: heading("Sign in") },
  {
    name: "create-account",
    path: "/register",
    options: { signedIn: false, registrationOpen: true },
    ready: heading("Create account"),
  },
  {
    name: "overview",
    path: "/",
    ready: async (page) => {
      await shown(page.getByRole("img", { name: "Bytes stored on each backend" }));
      await expect(page.getByRole("button", { name: "Check connections" })).toBeEnabled();
    },
  },
  {
    name: "files-mounts",
    path: "/files",
    ready: (page) => shown(page.getByRole("link", { name: "photos", exact: true })),
  },
  {
    name: "files-folder",
    path: "/files?path=%2Ffiles",
    ready: (page) => shown(page.getByRole("link", { name: "wifi-guest.txt", exact: true })),
  },
  {
    name: "files-details",
    path: "/files?path=%2Ffiles&file=README.txt",
    ready: (page) => shown(page.getByText("This folder syncs to the laptop").first()),
  },
  {
    name: "files-empty",
    path: "/files?path=%2Ffiles%2FScans",
    ready: (page) => shown(page.getByRole("heading", { name: "This folder is empty" })),
  },
  {
    name: "credentials",
    path: "/credentials",
    ready: (page) => shown(page.getByText("Work laptop", { exact: true }).first()),
  },
  {
    name: "credentials-create",
    path: "/credentials",
    ready: async (page) => {
      await shown(page.getByText("Work laptop", { exact: true }).first());
      await page.getByRole("button", { name: "Create key" }).first().click();
      await shown(page.getByRole("dialog").getByLabel("Name"));
    },
  },
  {
    name: "storage",
    path: "/storage",
    ready: (page) =>
      shown(page.getByRole("heading", { level: 3, name: "Photos bucket", exact: true })),
  },
  { name: "settings-profile", path: "/settings?section=profile", ready: section("Profile") },
  {
    name: "settings-security",
    path: "/settings?section=security",
    ready: section("Sign-in and security"),
  },
  {
    name: "settings-appearance",
    path: "/settings?section=appearance",
    ready: section("Appearance"),
  },
  {
    name: "settings-activity",
    path: "/settings?section=activity",
    ready: async (page) => {
      await section("Activity")(page);
      await shown(page.getByText("198.51.100.7").first());
    },
  },
  {
    name: "settings-about",
    path: "/settings?section=about",
    ready: async (page) => {
      await section("About this instance")(page);
      await shown(page.getByText("4f2c9a1").first());
    },
  },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`in ${scheme} mode`, () => {
    test.use({ colorScheme: scheme, storageState: { cookies: [], origins: [] } });

    for (const { name, path, options, ready } of SCREENS) {
      test(`Screenshot: ${name} in ${scheme} mode looks as its baseline`, async ({ page }) => {
        await showScreenData(page, options);
        await page.goto(path);
        await ready(page);
        await expect(placeholderRows(page)).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${name}-${scheme}.png`, { mask: [origin(page)] });
      });
    }
  });
}

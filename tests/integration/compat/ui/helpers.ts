import { expect, type Locator, type Page } from "@playwright/test";

// What the Dashboard's page specs share: how to find what a page shows, the clock and the
// clipboard a state needs, and the address of a file's preview.

export const PREVIEW = "/files?path=%2Fshared&file=wifi-guest.txt";

export const levelOne = (page: Page) => page.getByRole("heading", { level: 1 });
export const sideNavigation = (page: Page) =>
  page.getByRole("navigation", { name: "Side navigation" });
export const shown = (locator: Locator) => expect(locator).toBeVisible();
/**
 * Text on the screen, without the live regions that repeat it for screen readers: the page's own,
 * and the one a dialog keeps for its alerts.
 */
export const onScreen = (page: Page, text: string | RegExp) =>
  page
    .getByText(text)
    .and(page.locator(":not([data-astryx-live-region], [data-astryx-modal-live-region])"));

export const selectFirstRow = (page: Page) =>
  page.getByRole("row").nth(1).getByRole("checkbox").check();

/** Opens a Selector, in the dialog unless `scope` says where. One with a search field is a button. */
export const openList = async (
  page: Page,
  role: "combobox" | "button",
  name: string | RegExp,
  scope: Page | Locator = page.getByRole("dialog"),
) => {
  await scope.getByRole(role, { name }).click();
  await shown(page.getByRole("option").first());
};

/** Makes the browser refuse to copy, as it does on a plain-HTTP origin. */
export const blockClipboard = (page: Page) =>
  page.evaluate(() => {
    navigator.clipboard.writeText = () =>
      Promise.reject(new DOMException("Copying is blocked here.", "NotAllowedError"));
  });

export const CLOCK_START = new Date("2026-11-16T12:00:00Z");

/** Gives the page a clock the test can stop. Installed alone, it keeps running. */
export const installClock = (page: Page) => page.clock.install({ time: CLOCK_START });

/** Stops the page's timers, so a passing state stays while the scan reads it. */
export const stopTimers = (page: Page) =>
  page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000));

/** The box of an element that must be on screen. */
export const boxOf = async (target: Locator) => {
  const box = await target.boundingBox();
  if (box === null) {
    throw new Error("The element has no box.");
  }
  return box;
};

/** A card in the page's main region, found by something in it. */
export const cardWith = (page: Page, has: Locator) =>
  page.getByRole("main").locator(".astryx-card").filter({ has });

/** The placeholder rows of a listing, by the component class Astryx documents for Skeleton. */
export const placeholderRows = (page: Page) => page.locator(".astryx-skeleton");

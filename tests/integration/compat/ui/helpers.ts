import { expect, type Locator, type Page } from "@playwright/test";

// What the Dashboard's page specs share: how to find what a page shows, the clock and the
// clipboard a state needs, the address of a file's preview and the check that a page does not
// scroll sideways.

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

const CLOCK_START = new Date("2026-11-16T12:00:00Z");

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

/** The names in a file listing, top to bottom, read from the links of its rows. */
export const listed = (page: Page): Promise<string[]> =>
  page
    .getByRole("row")
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => {
        const url = new URL(link.getAttribute("href") ?? "", location.origin);
        return (
          url.searchParams.get("file") ?? url.searchParams.get("path")?.split("/").at(-1) ?? ""
        );
      }),
    );

// Runs in the page: what scrolls or reaches past the window sideways. That is the main landmark
// and each element around it, up to the root, when it is wider inside than it is; each element in
// it that scrolls sideways, as a page does inside its layout and a table inside its frame; and each
// element whose visible part, after whatever clips it, reaches past an edge of the window. Text cut
// off with an ellipsis is cut off on purpose, so it does not count. Astryx renders the landmark as
// an element with role="main", not as <main>.
export const sidewaysOverflow = (): string[] => {
  const main = document.querySelector('[role="main"]');
  if (main === null) {
    return ["no main landmark"];
  }
  const found: string[] = [];
  for (let element: Element | null = main; element !== null; element = element.parentElement) {
    if (element.scrollWidth > element.clientWidth) {
      found.push(`${element.tagName}: ${element.scrollWidth} > ${element.clientWidth}`);
    }
  }
  const windowWidth = document.documentElement.clientWidth;
  for (const element of main.querySelectorAll("*")) {
    const style = getComputedStyle(element);
    // Labels kept for screen readers alone sit in a box 1 px wide that cuts them off on purpose.
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      element.getBoundingClientRect().width <= 1
    ) {
      continue;
    }
    const name = `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 30)}"`;
    const truncates = style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none";
    if (
      style.overflowX !== "visible" &&
      !truncates &&
      element.scrollWidth > element.clientWidth + 1
    ) {
      found.push(`scrolls ${element.scrollWidth} > ${element.clientWidth}: ${name}`);
    }
    // The part of the element that what clips it leaves in sight.
    let { left: start, right: end } = element.getBoundingClientRect();
    for (let clip = element.parentElement; clip !== null; clip = clip.parentElement) {
      if (getComputedStyle(clip).overflowX !== "visible") {
        const box = clip.getBoundingClientRect();
        start = Math.max(start, box.left);
        end = Math.min(end, box.right);
      }
    }
    if (end - start > 1 && (start < -0.5 || end > windowWidth + 0.5)) {
      found.push(`reaches ${Math.round(start)} to ${Math.round(end)}: ${name}`);
    }
  }
  return found;
};

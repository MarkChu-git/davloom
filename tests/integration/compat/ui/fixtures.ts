import { test as base, type Page } from "@playwright/test";
import { answerStepUp } from "./instances";

/**
 * Waits until the Dashboard has rendered the page. Each page's HTML is a frame prerendered without
 * data, inert until `apps/web/src/client.tsx` renders the page in its place (`__root.tsx`), so a
 * test that acted on it at once would click, type into or read the frame instead of the page.
 */
const untilRendered = async (page: Page) => {
  await page.waitForFunction(() => document.body !== null && !document.body.hasAttribute("inert"));
};

/**
 * `goto` and `reload` that return once the page has rendered, as a person sees it. A test that
 * names `waitUntil` itself, such as one that blocks the app's code to look at the HTML alone,
 * waits for what it names instead.
 */
const waitForRenders = (page: Page) => {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = async (url, options) => {
    const response = await goto(url, options);
    if (options?.waitUntil === undefined) await untilRendered(page);
    return response;
  };
  page.reload = async (options) => {
    const response = await reload(options);
    if (options?.waitUntil === undefined) await untilRendered(page);
    return response;
  };
};

/**
 * Playwright's test, with every page of the test's context loading as above, and every page
 * answering the Dashboard's step-up dialog. The shared session signed in when the run began, so a
 * spec that deletes, replaces or changes credentials later than the step-up window meets the
 * dialog, as a person would.
 */
export const test = base.extend<{ stepUp: undefined }>({
  context: async ({ context }, use) => {
    context.pages().forEach(waitForRenders);
    context.on("page", waitForRenders);
    await use(context);
  },
  stepUp: [
    async ({ page }, use) => {
      await answerStepUp(page);
      await use(undefined);
    },
    { auto: true },
  ],
});

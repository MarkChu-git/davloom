import { test as base } from "@playwright/test";
import { answerStepUp } from "./instances";

/**
 * Playwright's test, with every page answering the Dashboard's step-up dialog. The shared session
 * signed in when the run began, so a spec that deletes, replaces or changes credentials later
 * than the step-up window meets the dialog, as a person would.
 */
export const test = base.extend<{ stepUp: undefined }>({
  stepUp: [
    async ({ page }, use) => {
      await answerStepUp(page);
      await use(undefined);
    },
    { auto: true },
  ],
});

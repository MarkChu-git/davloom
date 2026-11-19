import { expect, test } from "@playwright/test";
import { BRAND_DARK, BRAND_LIGHT, backgroundOf } from "./colors";

const markColor = (page: import("@playwright/test").Page) =>
  backgroundOf(page.getByTestId("brand-mark"));
const bodyColor = (page: import("@playwright/test").Page) => backgroundOf(page.locator("body"));

test("the default mode is System", async ({ page }) => {
  await page.goto("/design-check");

  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
});

test("choosing Dark applies at once", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-check");
  expect(await markColor(page)).toBe(BRAND_LIGHT);

  await page.getByRole("radio", { name: "Dark" }).click();

  expect(await markColor(page)).toBe(BRAND_DARK);
});

test("the choice survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-check");
  await page.getByRole("radio", { name: "Dark" }).click();

  await page.reload();

  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  expect(await markColor(page)).toBe(BRAND_DARK);
});

test("the first paint after a reload is already dark, before any app code runs", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-check");
  const lightBody = await bodyColor(page);
  await page.getByRole("radio", { name: "Dark" }).click();
  const darkBody = await bodyColor(page);
  expect(darkBody).not.toBe(lightBody);

  // With the bundles blocked, only what the HTML itself carries can affect the page.
  await page.route("**/assets/*.js", (route) => route.abort());
  await page.reload();

  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  expect(await bodyColor(page)).toBe(darkBody);
});

test("System follows the operating system without a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-check");
  expect(await markColor(page)).toBe(BRAND_LIGHT);

  await page.emulateMedia({ colorScheme: "dark" });

  expect(await markColor(page)).toBe(BRAND_DARK);
});

test("Light overrides a dark operating system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/design-check");

  await page.getByRole("radio", { name: "Light" }).click();

  expect(await markColor(page)).toBe(BRAND_LIGHT);
});

const declarations = (page: import("@playwright/test").Page) =>
  page.locator('meta[name="color-scheme"]');
const rootScheme = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

/** The page keeps one color-scheme declaration, and it reads `light dark` whatever was chosen. */
const declaresBoth = async (page: import("@playwright/test").Page) => {
  await expect(declarations(page)).toHaveCount(1);
  await expect(declarations(page)).toHaveAttribute("content", "light dark");
};

test("Choosing a mode: the page declares both schemes, and its root uses the chosen one", async ({
  page,
}) => {
  await page.goto("/design-check");
  await declaresBoth(page);
  expect(await rootScheme(page)).toBe("light dark");

  await page.getByRole("radio", { name: "Dark" }).click();
  await expect.poll(() => rootScheme(page)).toBe("dark");
  await declaresBoth(page);

  await page.getByRole("radio", { name: "Light" }).click();
  await expect.poll(() => rootScheme(page)).toBe("light");
  await declaresBoth(page);

  await page.getByRole("radio", { name: "System" }).click();
  await expect.poll(() => rootScheme(page)).toBe("light dark");
  await declaresBoth(page);

  // A stored mode leaves the declaration alone, so hydration finds the element it rendered.
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await declaresBoth(page);
  expect(await rootScheme(page)).toBe("dark");

  // The first-paint script wrote the scheme into the root's own style, so a later choice must
  // replace it there too: the stylesheet's rules alone would lose to it.
  await page.getByRole("radio", { name: "Light" }).click();
  await expect.poll(() => rootScheme(page)).toBe("light");
  await declaresBoth(page);
  await page.getByRole("radio", { name: "System" }).click();
  await expect.poll(() => rootScheme(page)).toBe("light dark");
  await declaresBoth(page);
});

test("First paint: the root carries the stored mode and scheme before the body is parsed", async ({
  page,
}) => {
  await page.goto("/design-check");
  await page.getByRole("radio", { name: "Dark" }).click();

  // Runs before the page's own code. The parser hands pending mutation records over before it runs
  // each script, so the first record that sees <body> shows the root as the body began, before any
  // script inside the body could change it.
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (document.body !== null) {
        observer.disconnect();
        const root = document.documentElement;
        root.dataset.whenBodyBegan = `${root.dataset.theme ?? "none"} ${root.style.colorScheme}`;
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  // With the bundles blocked, only what the HTML itself carries can affect the page.
  await page.route("**/assets/*.js", (route) => route.abort());
  await page.reload();

  expect(await page.evaluate(() => document.documentElement.dataset.whenBodyBegan)).toBe(
    "dark dark",
  );
});

test("Two open tabs: a mode chosen in one tab reaches the other without a reload", async ({
  context,
}) => {
  const [first, second] = [await context.newPage(), await context.newPage()];
  for (const tab of [first, second]) {
    await tab.emulateMedia({ colorScheme: "light" });
    await tab.goto("/design-check");
    // The store hears other tabs once its code has run, a little after `load`. A tab that starts
    // later reads another tab's choice from storage and never takes the path under test, so wait
    // until the app has drawn.
    await expect(tab.getByRole("radio", { name: "System" })).toBeChecked();
  }
  // A reload starts a new document, which has a new time origin.
  const origin = await second.evaluate(() => performance.timeOrigin);
  const lightBody = await bodyColor(second);

  await first.getByRole("radio", { name: "Dark" }).click();
  await expect.poll(() => rootScheme(first)).toBe("dark");
  const darkBody = await bodyColor(first);
  expect(darkBody).not.toBe(lightBody);

  await expect.poll(() => bodyColor(second)).toBe(darkBody);
  await expect(second.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect.poll(() => rootScheme(second)).toBe("dark");
  expect(await second.evaluate(() => performance.timeOrigin)).toBe(origin);

  // A third tab opens with Dark stored, so its first-paint script wrote the scheme into the root's
  // own style. A mode chosen elsewhere must replace it there. This test goes through the storage
  // event, so the tab has to be listening first.
  const third = await context.newPage();
  await third.emulateMedia({ colorScheme: "light" });
  await third.goto("/design-check");
  await expect(third.getByRole("radio", { name: "Dark" })).toBeChecked();
  expect(await rootScheme(third)).toBe("dark");

  await first.getByRole("radio", { name: "Light" }).click();
  await expect.poll(() => bodyColor(third)).toBe(lightBody);
  await expect.poll(() => rootScheme(third)).toBe("light");
  await first.getByRole("radio", { name: "System" }).click();
  await expect.poll(() => rootScheme(third)).toBe("light dark");
  await expect(third.getByRole("radio", { name: "System" })).toBeChecked();
});

// A tab can still be loading when another tab chooses. Its first-paint script has run, so the root
// carries the scheme of the stored mode, and the store then starts from the new one. Holding the
// bundles back until the choice has reached the tab makes that order certain.
for (const [choice, scheme] of [
  ["Light", "light"],
  ["System", "light dark"],
] as const) {
  test(`Two open tabs: a tab still loading takes ${choice} and its scheme`, async ({ context }) => {
    const first = await context.newPage();
    await first.emulateMedia({ colorScheme: "light" });
    await first.goto("/design-check");
    await first.getByRole("radio", { name: "Dark" }).click();

    const loading = await context.newPage();
    await loading.emulateMedia({ colorScheme: "light" });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await loading.route("**/assets/*.js", async (route) => {
      await released;
      await route.continue();
    });
    await loading.goto("/design-check", { waitUntil: "domcontentloaded" });
    expect(await rootScheme(loading)).toBe("dark");
    await loading.evaluate(() => {
      addEventListener("storage", () => Reflect.set(window, "choiceArrived", true), { once: true });
    });

    await first.getByRole("radio", { name: choice }).click();
    await loading.waitForFunction(() => Reflect.get(window, "choiceArrived") === true);
    release();

    await expect(loading.getByRole("radio", { name: choice })).toBeChecked();
    await expect.poll(() => rootScheme(loading)).toBe(scheme);
  });
}

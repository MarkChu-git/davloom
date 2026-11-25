import { expect, type Locator, type Page } from "@playwright/test";
import { test, untilRendered } from "./fixtures";
import { levelOne } from "./helpers";
import { ADMIN } from "./instances";

// What a person types, or a password manager fills in, while the page is still the prerendered
// frame (apps/web/src/client.tsx) stays when the page renders in the frame's place, and so does the
// field the caret is in. Each case holds back some of the Dashboard's code until it has typed,
// then lets it load and checks what the rendered page shows.

/** Holds back the scripts that `glob` matches until `release` runs. */
const holdCode = async (page: Page, glob: string): Promise<() => void> => {
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route(glob, async (route) => {
    await held;
    await route.continue();
  });
  return release;
};

/** Answers GET /api/registration as an instance that has no owner yet. */
const freshInstance = (page: Page) =>
  page.route("**/api/registration", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { open: true } })
      : route.fulfill({ status: 500, json: {} }),
  );

interface EarlyForm {
  readonly name: string;
  readonly path: string;
  /** The build's chunk that holds the page's route component (apps/web/vite.config.ts). */
  readonly chunk: string;
  readonly locale: "en-US" | "zh-CN";
  /** Whether the case runs signed in, with the shared session. */
  readonly isSignedIn: boolean;
  readonly before?: (page: Page) => Promise<unknown>;
  /** The fields typed into, in order; the caret stays in the last. */
  readonly fields: readonly { field: (page: Page) => Locator; text: string }[];
  /** What a person then does on the rendered page, and what it shows when that works. */
  readonly after?: (page: Page) => Promise<void>;
}

const FORMS: readonly EarlyForm[] = [
  {
    name: "sign-in",
    path: "/sign-in",
    chunk: "sign-in",
    locale: "en-US",
    isSignedIn: false,
    fields: [
      {
        field: (page) => page.getByRole("textbox", { name: "Username or email" }),
        text: ADMIN.username,
      },
      { field: (page) => page.getByLabel("Password"), text: ADMIN.password },
    ],
    after: async (page) => {
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(levelOne(page)).toHaveText("Overview");
    },
  },
  {
    name: "sign-in in Chinese",
    path: "/sign-in",
    chunk: "sign-in",
    locale: "zh-CN",
    isSignedIn: false,
    fields: [
      {
        field: (page) => page.getByRole("textbox", { name: "用户名或电子邮件" }),
        text: ADMIN.email,
      },
      { field: (page) => page.getByLabel("密码"), text: ADMIN.password },
    ],
    after: async (page) => {
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(levelOne(page)).toHaveText("概览");
    },
  },
  {
    name: "Create account",
    path: "/register",
    chunk: "register",
    locale: "en-US",
    isSignedIn: false,
    before: freshInstance,
    fields: [
      { field: (page) => page.getByRole("textbox", { name: "Username" }), text: "owner" },
      { field: (page) => page.getByRole("textbox", { name: "Display name" }), text: "Owner" },
      {
        field: (page) => page.locator('input[autocomplete="new-password"]').first(),
        text: "a long enough password",
      },
    ],
    after: async (page) => {
      const sent = page.waitForRequest(
        (request) => request.method() === "POST" && request.url().endsWith("/api/registration"),
      );
      await page.getByRole("button", { name: "Create account" }).click();
      expect((await sent).postDataJSON()).toMatchObject({
        username: "owner",
        name: "Owner",
        password: "a long enough password",
      });
    },
  },
  {
    name: "the profile in Settings",
    path: "/settings",
    chunk: "settings",
    locale: "en-US",
    isSignedIn: true,
    fields: [
      {
        field: (page) => page.getByRole("textbox", { name: "Display name" }),
        text: "Admin, typed early",
      },
    ],
  },
  {
    name: "the search in Files",
    path: "/files",
    chunk: "files",
    locale: "en-US",
    isSignedIn: true,
    fields: [{ field: (page) => page.getByRole("searchbox"), text: "wifi" }],
  },
];

/** How much of the Dashboard's code a case holds back while it types. */
const HOLDS = [
  // Every script: the person types before any of the page's code has run.
  { name: "before any code runs", scripts: () => "**/assets/*.js" },
  // The page's route component: the entry has run and started up, and the person types while the
  // router waits for the page's code.
  { name: "while the page starts", scripts: (form: EarlyForm) => `**/assets/${form.chunk}-*.js` },
] as const;

for (const form of FORMS) {
  test.describe(`${form.name} before the page has started`, () => {
    test.use({
      locale: form.locale,
      ...(form.isSignedIn ? {} : { storageState: { cookies: [], origins: [] } }),
    });

    for (const hold of HOLDS) {
      test(`${form.name}, typed ${hold.name}: what was typed stays, with the caret`, async ({
        page,
      }) => {
        const last = form.fields.at(-1);
        if (last === undefined) throw new Error(`${form.name} names no field`);
        await form.before?.(page);
        const release = await holdCode(page, hold.scripts(form));
        await page.goto(form.path, { waitUntil: "domcontentloaded" });
        for (const { field, text } of form.fields) {
          await field(page).fill(text);
        }
        // A person types on into the field the caret is in, one key at a time.
        await last.field(page).press("End");
        await page.keyboard.type("!");
        expect(await page.evaluate(() => document.body.hasAttribute("data-frame"))).toBe(true);

        release();
        await untilRendered(page);
        for (const { field, text } of form.fields) {
          await expect(field(page)).toHaveValue(field === last.field ? `${text}!` : text);
        }
        await expect(last.field(page)).toBeFocused();
        // Typing goes on in the rendered page's field, at the end of what is there.
        await page.keyboard.press("Backspace");
        for (const { field, text } of form.fields) {
          await expect(field(page)).toHaveValue(text);
        }
        await form.after?.(page);
      });
    }
  });
}

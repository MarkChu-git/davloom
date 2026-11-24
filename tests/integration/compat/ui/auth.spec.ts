import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { levelOne, navigationLinks, onScreen, shown } from "./helpers";
import { ADMIN } from "./instances";

// Signing in, signing out and registration. These tests start without the shared session, and
// sign in with sessions of their own, since signing out ends the session that signs it out.
test.use({ storageState: { cookies: [], origins: [] } });

const identifierField = (page: Page) => page.getByRole("textbox", { name: "Username or email" });

const signIn = async (page: Page, identifier = ADMIN.username, password = ADMIN.password) => {
  await identifierField(page).fill(identifier);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
};

/** Answers the confirmation that every Sign out asks for. */
const confirmSignOut = async (page: Page) => {
  const dialog = page.getByRole("alertdialog", { name: "Sign out?" });
  await shown(dialog);
  await dialog.getByRole("button", { name: "Sign out" }).click();
};

test("No session: a Dashboard page opens the sign-in page, and signing in returns to it", async ({
  page,
}) => {
  await page.goto("/credentials");
  await expect(levelOne(page)).toHaveText("Sign in");
  await expect(page).toHaveTitle("Sign in | Davloom");
  expect(new URL(page.url()).searchParams.get("redirect")).toBe("/credentials");

  await signIn(page);
  await expect(levelOne(page)).toHaveText("Credentials");
  await expect(page).toHaveURL(/\/credentials$/);
});

test("An owner exists: the sign-in page offers no way to create an account", async ({ page }) => {
  await page.goto("/sign-in");
  await shown(identifierField(page));
  await expect(page.getByRole("link", { name: /create account|register/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /create account|register/i })).toHaveCount(0);
});

test("Signing in with the email: the email the owner gave works as well as the username", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await signIn(page, ADMIN.email);
  await expect(levelOne(page)).toHaveText("Overview");
});

test("A wrong password: the form stays and says the username or the password is wrong", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await signIn(page, ADMIN.username, "not the password at all");
  await shown(onScreen(page, "The username or the password is wrong."));
  await expect(levelOne(page)).toHaveText("Sign in");
});

test("Empty fields: each says what it needs, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/auth/")) {
      sent.push(request.url());
    }
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await shown(onScreen(page, "Enter your username or email."));
  await shown(onScreen(page, "Enter your password."));
  expect(sent).toEqual([]);
});

test("Autofill purposes: the identifier field declares username and the password current-password", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(identifierField(page)).toHaveAttribute("autocomplete", /username/);
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", /current-password/);
});

test("A return address on another site: signing in opens the Overview instead", async ({
  page,
}) => {
  await page.goto("/sign-in?redirect=%2F%2Fevil.example%2F");
  await signIn(page);
  await expect(levelOne(page)).toHaveText("Overview");
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
});

// On a phone the side navigation's Sign out is in the dropdown of the Menu button.
test("Signing out: the side navigation's Sign out asks first, ends the session, and the Dashboard asks to sign in again", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await signIn(page);
  await expect(levelOne(page)).toHaveText("Overview");

  await (await navigationLinks(page)).getByRole("button", { name: "Sign out" }).click();
  await confirmSignOut(page);
  await expect(levelOne(page)).toHaveText("Sign in");
  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(401);
  await page.goto("/");
  await expect(levelOne(page)).toHaveText("Sign in");
});

test("Cancelling a sign-out: the session stays", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page);
  await expect(levelOne(page)).toHaveText("Overview");
  await (await navigationLinks(page)).getByRole("button", { name: "Sign out" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Sign out?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(levelOne(page)).toHaveText("Overview");
  expect((await page.request.get("/api/me")).status()).toBe(200);
});

test("Signing out from Settings: Sign-in and security signs this browser out", async ({ page }) => {
  await page.goto("/sign-in?redirect=%2Fsettings%3Fsection%3Dsecurity");
  await signIn(page);
  await shown(page.getByRole("heading", { level: 2, name: "Sign-in and security" }));
  await page.getByRole("main").getByRole("button", { name: "Sign out", exact: true }).click();
  await confirmSignOut(page);
  await expect(levelOne(page)).toHaveText("Sign in");
});

test("Registration after an owner exists: the register page sends a person to sign in", async ({
  page,
}) => {
  await page.goto("/register");
  await expect(levelOne(page)).toHaveText("Sign in");
  await expect(page).toHaveURL(/\/sign-in$/);
});

/** Answers GET /api/registration as an instance that has no owner yet. */
const freshInstance = (page: Page, refusal?: { status: number; json: unknown }) =>
  page.route("**/api/registration", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { open: true } })
      : route.fulfill(refusal ?? { status: 500, json: {} }),
  );

const newPassword = (page: Page) => page.locator('input[autocomplete="new-password"]');

test("A fresh instance: sign-in sends a person to Create account, which asks for a username and a password of 12 characters and shows the server's reason", async ({
  page,
}) => {
  await freshInstance(page, {
    status: 400,
    json: {
      error: {
        code: "password_refused",
        message: "This password appears in known data breaches. Choose another.",
      },
    },
  });
  await page.goto("/sign-in");
  await expect(levelOne(page)).toHaveText("Create account");
  await expect(page).toHaveURL(/\/register$/);

  await page.getByRole("textbox", { name: "Username" }).fill("owner");
  await newPassword(page).fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await shown(onScreen(page, "Use at least 12 characters."));

  await newPassword(page).fill("a long enough password");
  await page.getByRole("button", { name: "Create account" }).click();
  await shown(onScreen(page, "This password appears in known data breaches. Choose another."));
});

test("Generate: Create account fills in a random password and offers to copy it", async ({
  page,
}) => {
  await freshInstance(page);
  await page.goto("/register");
  await page.getByRole("button", { name: "Generate" }).click();
  const first = await newPassword(page).inputValue();
  expect(first).toMatch(/^[A-Za-z0-9_-]{24}$/);
  await shown(page.getByRole("button", { name: "Copy" }));
  await page.getByRole("button", { name: "Generate" }).click();
  expect(await newPassword(page).inputValue()).not.toBe(first);
});

test("Create account from an export: the form asks for the file and its key, shows why an import is refused, and sends a person to sign in once it is done", async ({
  page,
}) => {
  let open = true;
  await page.route("**/api/registration", (route) => route.fulfill({ json: { open } }));
  let answer: { status: number; json: unknown } = {
    status: 422,
    json: {
      error: {
        code: "archive_invalid",
        message: "The key does not open this file, or the file is damaged.",
      },
    },
  };
  const sent: unknown[] = [];
  await page.route("**/api/registration/import", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill(answer);
  });
  await page.goto("/register");
  await page.getByRole("radio", { name: "From an export" }).click();
  await page.getByRole("button", { name: "Import" }).click();
  await shown(onScreen(page, "Choose the export file."));
  await shown(onScreen(page, "Enter the export key."));

  await page.locator('input[type="file"]').setInputFiles({
    name: "davloom-export.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "davloom-export", version: 1 })),
  });
  await page.getByLabel("Export key").fill("dvx_key");
  await page.getByRole("button", { name: "Import" }).click();
  await shown(onScreen(page, "The key does not open this file, or the file is damaged."));
  expect(sent).toEqual([{ key: "dvx_key", file: { format: "davloom-export", version: 1 } }]);

  answer = { status: 201, json: { user: 1 } };
  open = false;
  await page.getByRole("button", { name: "Import" }).click();
  await expect(levelOne(page)).toHaveText("Sign in");
});

test("Create account from a file that is not JSON: the form says so and sends nothing", async ({
  page,
}) => {
  await freshInstance(page);
  let calls = 0;
  await page.route("**/api/registration/import", (route) => {
    calls += 1;
    return route.fulfill({ status: 201, json: {} });
  });
  await page.goto("/register");
  await page.getByRole("radio", { name: "From an export" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from("not json"),
  });
  await page.getByLabel("Export key").fill("dvx_key");
  await page.getByRole("button", { name: "Import" }).click();
  await shown(onScreen(page, "That file is not a Davloom export."));
  expect(calls).toBe(0);
});

import { expect, test, type Page } from "@playwright/test";
import { levelOne, onScreen, shown, sideNavigation } from "./helpers";
import { ADMIN } from "./instances";

// Signing in, signing out and first-run setup. These tests start without the shared session, and
// sign in with sessions of their own, since signing out ends the session that signs it out.
test.use({ storageState: { cookies: [], origins: [] } });

const signIn = async (page: Page, email = ADMIN.email, password = ADMIN.password) => {
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
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

test("A wrong password: the form stays and says the email or the password is wrong", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await signIn(page, ADMIN.email, "not the password at all");
  await shown(onScreen(page, "The email or the password is wrong."));
  await expect(levelOne(page)).toHaveText("Sign in");
});

test("Empty fields: each says what it needs, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/auth/")) sent.push(request.url());
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in" }).click();
  await shown(onScreen(page, "Enter the email you set up Davloom with."));
  await shown(onScreen(page, "Enter your password."));
  expect(sent).toEqual([]);
});

test("Autofill purposes: the email field declares username and the password current-password", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "autocomplete",
    "username",
  );
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
});

test("A return address on another site: signing in opens the Overview instead", async ({
  page,
}) => {
  await page.goto("/sign-in?redirect=%2F%2Fevil.example%2F");
  await signIn(page);
  await expect(levelOne(page)).toHaveText("Overview");
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
});

test("Signing out: the side navigation's Sign out ends the session, and the Dashboard asks to sign in again", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await signIn(page);
  await expect(levelOne(page)).toHaveText("Overview");

  await sideNavigation(page).getByRole("button", { name: "Sign out" }).click();
  await expect(levelOne(page)).toHaveText("Sign in");
  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(401);
  await page.goto("/");
  await expect(levelOne(page)).toHaveText("Sign in");
});

test("Signing out from Settings: Sign-in and security signs this browser out", async ({ page }) => {
  await page.goto("/sign-in?redirect=%2Fsettings%3Fsection%3Dsecurity");
  await signIn(page);
  await shown(page.getByRole("heading", { level: 2, name: "Sign-in and security" }));
  await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
  await expect(levelOne(page)).toHaveText("Sign in");
});

test("Setup after setup: the setup page sends a person to sign in", async ({ page }) => {
  await page.goto("/setup");
  await expect(levelOne(page)).toHaveText("Sign in");
  await expect(page).toHaveURL(/\/sign-in$/);
});

/** Answers GET /api/setup as an instance that has no administrator yet. */
const freshInstance = (page: Page, { open = true, refusal = "" } = {}) =>
  page.route("**/api/setup", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { needed: true, open } })
      : route.fulfill({ status: 403, json: { error: { code: refusal } } }),
  );

test("A fresh instance: sign-in sends a person to setup, which asks for name, email, a password of 12 characters and the token", async ({
  page,
}) => {
  await freshInstance(page, { refusal: "setup_token_invalid" });
  await page.goto("/sign-in");
  await expect(levelOne(page)).toHaveText("Set up Davloom");
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByRole("textbox", { name: "Name" }).fill("Owner");
  await page.getByRole("textbox", { name: "Email" }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Setup token").fill("token");
  await page.getByRole("button", { name: "Create administrator" }).click();
  await shown(onScreen(page, "Use at least 12 characters."));

  await page.getByLabel("Password", { exact: true }).fill("a long enough password");
  await page.getByRole("button", { name: "Create administrator" }).click();
  await shown(
    onScreen(page, "The setup token is wrong. It is the DAVLOOM_SETUP_TOKEN of this deployment."),
  );
});

test("Setup without a token on the deployment: the page says setup is closed and how to open it", async ({
  page,
}) => {
  await freshInstance(page, { open: false });
  await page.goto("/setup");
  await shown(onScreen(page, "Setup is closed"));
  await shown(onScreen(page, "Set DAVLOOM_SETUP_TOKEN on this deployment, then reload this page."));
  await expect(page.getByRole("button", { name: "Create administrator" })).toHaveCount(0);
});

test("Setup from an export: the form asks for the file, its key and the token, shows why an import is refused, and sends a person to sign in once it is done", async ({
  page,
}) => {
  await freshInstance(page);
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
  await page.route("**/api/setup/import", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill(answer);
  });
  await page.goto("/setup");
  await page.getByRole("radio", { name: "From an export" }).click();
  await page.getByRole("button", { name: "Import" }).click();
  await shown(onScreen(page, "Choose the export file."));
  await shown(onScreen(page, "Enter the key shown with the export."));
  await shown(onScreen(page, "Enter the setup token."));

  await page.locator('input[type="file"]').setInputFiles({
    name: "davloom-export.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "davloom-export", version: 1 })),
  });
  await page.getByLabel("Export key").fill("dvx_key");
  await page.getByLabel("Setup token").fill("token");
  await page.getByRole("button", { name: "Import" }).click();
  await shown(onScreen(page, "The key does not open this file, or the file is damaged."));
  expect(sent).toEqual([
    { token: "token", key: "dvx_key", file: { format: "davloom-export", version: 1 } },
  ]);

  answer = { status: 201, json: { user: 1 } };
  await page.unroute("**/api/setup");
  await page.route("**/api/setup", (route) =>
    route.fulfill({ json: { needed: false, open: false } }),
  );
  await page.getByRole("button", { name: "Import" }).click();
  await expect(levelOne(page)).toHaveText("Sign in");
});

test("Setup from a file that is not JSON: the form says so and sends nothing", async ({ page }) => {
  await freshInstance(page);
  let calls = 0;
  await page.route("**/api/setup/import", (route) => {
    calls += 1;
    return route.fulfill({ status: 201, json: {} });
  });
  await page.goto("/setup");
  await page.getByRole("radio", { name: "From an export" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from("not json"),
  });
  await page.getByLabel("Export key").fill("dvx_key");
  await page.getByLabel("Setup token").fill("token");
  await page.getByRole("button", { name: "Import" }).click();
  await shown(onScreen(page, "That file is not a Davloom export."));
  expect(calls).toBe(0);
});

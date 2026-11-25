import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectChinese } from "../../test/chinese";
import { json, renderPage, type Handler } from "../../test/render";
import { passkeyApi, stubPasskeys } from "../../test/webauthn";
import { SignInPage } from "./SignInPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ME = {
  id: "u",
  name: "Owner",
  username: "owner",
  email: null,
  twoFactorEnabled: false,
  verifiedAt: 0,
};
const SIGNED_OUT = () => json({ error: { code: "unauthorized" } }, 401);
const CLOSED: Handler = () => json({ open: false });
const PASSKEYS_ON: Handler = () => json({ open: false, passkeys: true });
/** Better Auth's session endpoint for a visitor who is not signed in. */
const NO_SESSION: Handler = () => json(null);

const showForm = async (api: Record<string, Handler> = {}, redirect?: string) => {
  const page = await renderPage(<SignInPage redirect={redirect} />, {
    path: "/sign-in",
    api: {
      "GET /api/auth/get-session": NO_SESSION,
      "GET /api/me": SIGNED_OUT,
      "GET /api/registration": CLOSED,
      ...api,
    },
  });
  await screen.findByRole("heading", { name: "Sign in" });
  return page;
};

const fill = async (identifier: string, password: string) => {
  if (identifier !== "") {
    await userEvent.type(screen.getByLabelText("Username or email"), identifier);
  }
  if (password !== "") {
    await userEvent.type(screen.getByLabelText("Password"), password);
  }
};

/** Signs in with a password, which leads to the second step. */
const secondStep = async (verify: Record<string, Handler>) => {
  let signedIn = false;
  const page = await showForm({
    "GET /api/me": () => (signedIn ? json(ME) : SIGNED_OUT()),
    "POST /api/auth/sign-in/username": () => json({ twoFactorRedirect: true }),
    ...Object.fromEntries(
      Object.entries(verify).map(([key, handler]) => [
        key,
        async (request: Request) => {
          const response = await handler(request);
          signedIn = response.ok;
          return response;
        },
      ]),
    ),
  });
  await fill("owner", "correct horse");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Two-step verification" });
  return page;
};

describe("SignInPage", () => {
  it("shows the form while it checks the session", async () => {
    await renderPage(<SignInPage />, {
      api: {
        "GET /api/auth/get-session": () => new Promise<Response>(() => undefined),
        "GET /api/registration": CLOSED,
      },
    });
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
  });

  it.each([
    [undefined, "/"],
    ["/files?path=%2Ffiles", "/files?path=%2Ffiles"],
    ["//evil.example", "/"],
  ])("a signed-in visit with redirect %j opens %j", async (redirect, href) => {
    const { router } = await renderPage(<SignInPage redirect={redirect} />, {
      path: "/sign-in",
      api: {
        "GET /api/auth/get-session": () => json({ user: ME }),
        "GET /api/registration": CLOSED,
      },
    });
    await waitFor(() => expect(router.state.location.href).toBe(href));
  });

  it("sends a visitor of an instance without an owner to create the account", async () => {
    const { router } = await renderPage(<SignInPage />, {
      path: "/sign-in",
      api: {
        "GET /api/auth/get-session": NO_SESSION,
        "GET /api/registration": () => json({ open: true }),
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/register"));
  });

  it("offers no way to create an account once an owner exists", async () => {
    await showForm();
    expect(screen.queryByRole("link", { name: /create/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
  });

  it.each([
    ["", "", ["Enter your username or email.", "Enter your password."]],
    ["   ", "secret", ["Enter your username or email."]],
    ["owner", "", ["Enter your password."]],
  ])("refuses %j with password %j before sending", async (identifier, password, problems) => {
    const { calls } = await showForm();
    await fill(identifier, password);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    for (const problem of problems) {
      expect((await screen.findAllByText(problem)).length).toBeGreaterThan(0);
    }
    expect(calls.some((call) => call.url.includes("/api/auth/sign-in/"))).toBe(false);
  });

  it("clears a field's problem once the field changes", async () => {
    await showForm();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your password.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Password"), "x");
    expect(screen.queryByText("Enter your password.")).toBeNull();
    await userEvent.type(screen.getByLabelText("Username or email"), "a");
    expect(screen.queryByText("Enter your username or email.")).toBeNull();
  });

  it.each([
    ["the button", "owner", "username", { username: "owner" }, undefined, "/"],
    ["Enter", "owner", "username", { username: "owner" }, "/credentials", "/credentials"],
    [
      "the button",
      "me@example.com",
      "email",
      { email: "me@example.com" },
      "https://evil.example/",
      "/",
    ],
  ] as const)(
    "signs in with %s by %j through sign-in/%s and opens redirect %j at %j",
    async (how, identifier, route, body, redirect, href) => {
      let signedIn = false;
      const { router, calls } = await showForm(
        {
          "GET /api/me": () => (signedIn ? json(ME) : SIGNED_OUT()),
          [`POST /api/auth/sign-in/${route}`]: () => {
            signedIn = true;
            return json({ token: "t", user: {} });
          },
        },
        redirect,
      );
      await fill(` ${identifier} `, "correct horse");
      if (how === "Enter") {
        await userEvent.type(screen.getByLabelText("Password"), "{Enter}");
      } else {
        await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
      }
      await waitFor(() => expect(router.state.location.href).toBe(href));
      const sent = calls.find((call) => call.url.endsWith(`/api/auth/sign-in/${route}`));
      expect(await sent?.json()).toEqual({ ...body, password: "correct horse" });
    },
  );

  it.each([
    [json({ error: { code: "unauthorized" } }, 401), "The username or the password is wrong."],
    [
      json({ code: "INVALID_USERNAME_OR_PASSWORD", message: "x" }, 403),
      "The username or the password is wrong.",
    ],
    [json({ error: { code: "boom" } }, 500), "The server refused the request (500)."],
  ])("says why a sign-in failed (%#)", async (response, message) => {
    await showForm({ "POST /api/auth/sign-in/username": () => response.clone() });
    await fill("owner", "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Sign in" }).disabled).toBe(false);
  });

  it("warns when the registration state cannot be read, and still offers the form", async () => {
    await showForm({ "GET /api/registration": () => json({ error: { code: "x" } }, 503) });
    expect(await screen.findByText("The server refused the request (503).")).toBeTruthy();
    expect(screen.getByLabelText("Username or email")).toBeTruthy();
  });

  describe("with two-step verification on", () => {
    it("asks for the authenticator code, and signs in with it", async () => {
      const { router, calls } = await secondStep({
        "POST /api/auth/two-factor/verify-totp": () => json({ token: "t" }),
      });
      await userEvent.type(screen.getByLabelText("Authenticator code"), "123 456{Enter}");
      await waitFor(() => expect(router.state.location.href).toBe("/"));
      const sent = calls.find((call) => call.url.endsWith("/two-factor/verify-totp"));
      expect(await sent?.json()).toEqual({ code: "123456" });
    });

    it("takes a backup code instead", async () => {
      const { router, calls } = await secondStep({
        "POST /api/auth/two-factor/verify-backup-code": () => json({ token: "t" }),
      });
      await userEvent.click(screen.getByRole("button", { name: "Use a backup code" }));
      await userEvent.type(screen.getByLabelText("Backup code"), "abcd-efgh");
      await userEvent.click(screen.getByRole("button", { name: "Verify" }));
      await waitFor(() => expect(router.state.location.href).toBe("/"));
      const sent = calls.find((call) => call.url.endsWith("/two-factor/verify-backup-code"));
      expect(await sent?.json()).toEqual({ code: "abcd-efgh" });
    });

    it.each([
      [json({ code: "INVALID_CODE", message: "x" }, 401), "The code is wrong or has expired."],
      [
        json({ code: "ACCOUNT_TEMPORARILY_LOCKED", message: "x" }, 429),
        "Too many wrong codes. Wait a few minutes and try again.",
      ],
      [
        json({ code: "INVALID_TWO_FACTOR_COOKIE", message: "x" }, 401),
        "The sign-in has expired. Start again.",
      ],
    ])("says why a code failed (%#)", async (response, message) => {
      await secondStep({ "POST /api/auth/two-factor/verify-totp": () => response.clone() });
      await userEvent.type(screen.getByLabelText("Authenticator code"), "000000{Enter}");
      expect(await screen.findByText(message)).toBeTruthy();
    });

    it("refuses an empty code, and starts again on request", async () => {
      await secondStep({});
      await userEvent.click(screen.getByRole("button", { name: "Verify" }));
      expect(
        (await screen.findAllByText("Enter the code from your authenticator app.")).length,
      ).toBeGreaterThan(0);
      await userEvent.click(screen.getByRole("button", { name: "Start again" }));
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    });
  });

  it("sends the form with Enter in the identifier field too", async () => {
    const { calls } = await showForm({
      "POST /api/auth/sign-in/username": () => json({ error: { code: "unauthorized" } }, 401),
    });
    await fill("", "correct horse");
    await userEvent.type(screen.getByLabelText("Username or email"), "owner{Enter}");
    expect(await screen.findByText("The username or the password is wrong.")).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith("/api/auth/sign-in/username"))).toBe(true);
  });

  describe("with two-step verification on, more", () => {
    it("refuses an empty backup code before sending", async () => {
      const { calls } = await secondStep({});
      await userEvent.click(screen.getByRole("button", { name: "Use a backup code" }));
      await userEvent.click(screen.getByRole("button", { name: "Verify" }));
      expect((await screen.findAllByText("Enter a backup code.")).length).toBeGreaterThan(0);
      expect(calls.some((call) => call.url.includes("/two-factor/verify-"))).toBe(false);
    });

    it("says what went wrong with a code the server could not check", async () => {
      await secondStep({
        "POST /api/auth/two-factor/verify-totp": () => json({ error: { code: "boom" } }, 500),
      });
      await userEvent.type(screen.getByLabelText("Authenticator code"), "123456{Enter}");
      expect(await screen.findByText("The server refused the request (500).")).toBeTruthy();
    });
  });

  describe("with a passkey", () => {
    it("signs in and opens the Dashboard", async () => {
      const credentials = stubPasskeys();
      let signedIn = false;
      const { router } = await showForm({
        "GET /api/me": () => (signedIn ? json(ME) : SIGNED_OUT()),
        "GET /api/registration": PASSKEYS_ON,
        ...passkeyApi({
          authentication: () => {
            signedIn = true;
            return json({ session: { token: "t" }, user: { id: "u" } });
          },
        }),
      });
      await userEvent.click(await screen.findByRole("button", { name: "Sign in with a passkey" }));
      await waitFor(() => expect(router.state.location.href).toBe("/"));
      expect(credentials.get).toHaveBeenCalledTimes(1);
    });

    it("says so when the person cancels, and keeps the form", async () => {
      stubPasskeys({ cancel: true });
      await showForm({ "GET /api/registration": PASSKEYS_ON, ...passkeyApi() });
      await userEvent.click(await screen.findByRole("button", { name: "Sign in with a passkey" }));
      expect(await screen.findByText("Auth cancelled")).toBeTruthy();
      expect(screen.getByLabelText("Username or email")).toBeTruthy();
    });
  });

  it.each([
    ["off", { open: false }, false],
    ["off on the server", { open: false, passkeys: false }, false],
    ["on", { open: false, passkeys: true }, true],
  ])("offers a passkey sign-in only when passkeys are %s", async (_case, status, shown) => {
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    await showForm({ "GET /api/registration": () => json(status) });
    // The form shows before the instance has answered; the passkey button follows its answer.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Sign in with a passkey" }) !== null).toBe(shown),
    );
  });
});

describe("SignInPage in Chinese", () => {
  it("writes its form in Chinese", async () => {
    const { container } = await renderPage(<SignInPage />, {
      path: "/sign-in",
      locale: "zh-CN",
      api: {
        "GET /api/auth/get-session": NO_SESSION,
        "GET /api/me": SIGNED_OUT,
        "GET /api/registration": CLOSED,
      },
    });
    expect(await screen.findByRole("heading", { name: "登录" })).toBeTruthy();
    expect(screen.getByLabelText("用户名或电子邮件")).toBeTruthy();
    expectChinese(container);
  });
});

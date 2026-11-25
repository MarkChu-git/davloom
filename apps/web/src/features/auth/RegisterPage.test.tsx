import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCanceledAnimations } from "../../test/layout";
import { json, renderPage, type Handler } from "../../test/render";
import { RegisterPage } from "./RegisterPage";

handleCanceledAnimations();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OPEN: Handler = () => json({ open: true });

const showForm = async (api: Record<string, Handler> = {}) => {
  const page = await renderPage(<RegisterPage />, {
    path: "/register",
    api: { "GET /api/registration": OPEN, ...api },
  });
  await screen.findByRole("heading", { name: "Create account" });
  return page;
};

/** The password field, whose group also names its Generate and Copy buttons. */
const passwordInput = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>('input[autocomplete="new-password"]');
  if (input === null) throw new Error("no password field");
  return input;
};

const sentBody = async (calls: Request[], path: string): Promise<unknown> =>
  await calls.find((call) => call.method === "POST" && call.url.endsWith(path))?.json();

/** Chooses an export file with this text. */
const upload = async (text: string) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input");
  await userEvent.upload(input, new File([text], "export.json", { type: "application/json" }));
};

/** The form that imports an export. */
const importForm = async (api: Record<string, Handler> = {}) => {
  const page = await showForm(api);
  await userEvent.click(screen.getByRole("radio", { name: "From an export" }));
  return page;
};

describe("RegisterPage", () => {
  it("shows the form while it asks whether the instance has an owner", async () => {
    await renderPage(<RegisterPage />, {
      api: { "GET /api/registration": () => new Promise<Response>(() => undefined) },
    });
    expect(screen.getByRole("heading", { name: "Create account" })).toBeTruthy();
    expect(screen.getByLabelText("Username")).toBeTruthy();
  });

  it("sends every visitor to sign in once an owner exists", async () => {
    const { router } = await renderPage(<RegisterPage />, {
      path: "/register",
      api: { "GET /api/registration": () => json({ open: false }) },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
  });

  it("says when the instance cannot be read, and asks again", async () => {
    let answer = json({ error: { code: "x" } }, 503);
    await renderPage(<RegisterPage />, {
      api: { "GET /api/registration": () => answer.clone() },
    });
    expect(await screen.findByText("The server refused the request (503).")).toBeTruthy();
    answer = json({ open: true });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Username")).toBeTruthy();
  });

  it("creates the account with a username and password alone, and signs in", async () => {
    let signedIn = false;
    const { router, calls } = await showForm({
      "POST /api/registration": () => json({ userId: "u" }, 201),
      "POST /api/auth/sign-in/username": () => {
        signedIn = true;
        return json({ token: "t" });
      },
      "GET /api/me": () =>
        signedIn ? json({ id: "u" }) : json({ error: { code: "unauthorized" } }, 401),
    });
    await userEvent.type(screen.getByLabelText("Username"), " owner ");
    await userEvent.type(passwordInput(), "a long password here");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await sentBody(calls, "/api/registration")).toEqual({
      username: "owner",
      name: "",
      email: "",
      password: "a long password here",
    });
    expect(await sentBody(calls, "/api/auth/sign-in/username")).toEqual({
      username: "owner",
      password: "a long password here",
    });
  });

  it("generates a password, shows it, and offers to copy it", async () => {
    const { calls } = await showForm({
      "POST /api/registration": () => json({ userId: "u" }, 201),
      "POST /api/auth/sign-in/username": () => json({ token: "t" }),
    });
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));
    const first = passwordInput().value;
    expect(first).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(passwordInput().type).toBe("text");
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(passwordInput().value).not.toBe(first);
    // Typing over a generated password hides it again, and Copy goes with it.
    await userEvent.type(passwordInput(), "x");
    expect(passwordInput().type).toBe("password");
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));
    await userEvent.type(screen.getByLabelText("Username"), "owner");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(await sentBody(calls, "/api/registration")).toMatchObject({
      password: passwordInput().value,
    });
  });

  it("refuses fields that cannot be sent", async () => {
    const { calls } = await showForm();
    await userEvent.type(screen.getByRole("textbox", { name: /^Email/ }), "nope");
    await userEvent.type(passwordInput(), "short");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findAllByText("Enter a username.")).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Enter an email address, such as you@example.com.").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Use at least 12 characters.").length).toBeGreaterThan(0);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it.each([
    [
      json(
        {
          error: {
            code: "password_refused",
            message: "This password appears in known data breaches. Choose another.",
          },
        },
        400,
      ),
      "This password appears in known data breaches. Choose another.",
    ],
    [
      json({ error: { code: "username_refused", message: "Username is already taken." } }, 400),
      "Username is already taken.",
    ],
    [
      json({ error: { code: "password_check_failed", message: "Failed" } }, 503),
      "Davloom could not check the password against known breaches. Try again later.",
    ],
  ])("shows the server's reason (%#)", async (answer, message) => {
    await showForm({ "POST /api/registration": () => answer.clone() });
    await userEvent.type(screen.getByLabelText("Username"), "owner");
    await userEvent.type(passwordInput(), "password1234");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Create account" }).disabled).toBe(
      false,
    );
  });

  it("sends a visitor who lost the race to sign in", async () => {
    let open = true;
    const { router } = await showForm({
      "GET /api/registration": () => json({ open }),
      "POST /api/registration": () => {
        open = false;
        return json({ error: { code: "registration_closed" } }, 409);
      },
    });
    await userEvent.type(screen.getByLabelText("Username"), "owner");
    await userEvent.type(passwordInput(), "a long password here");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
  });

  it("imports an export instead, with its key", async () => {
    const { router, calls } = await showForm({
      "POST /api/registration/import": () => json({ user: 1 }, 201),
    });
    await userEvent.click(screen.getByRole("radio", { name: "From an export" }));
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect((await screen.findAllByText("Choose the export file.")).length).toBeGreaterThan(0);
    const file = new File([JSON.stringify({ format: "davloom-export" })], "export.json", {
      type: "application/json",
    });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no file input");
    await userEvent.upload(input, file);
    await userEvent.type(screen.getByLabelText("Export key"), "the-key");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(await sentBody(calls, "/api/registration/import")).toEqual({
      key: "the-key",
      file: { format: "davloom-export" },
    });
  });

  it("asks for no setup token when the deployment sets none", async () => {
    await showForm();
    expect(screen.queryByLabelText("Setup token")).toBeNull();
  });

  it("sends the setup token the deployment asks for, and shows a refusal under it", async () => {
    let attempts = 0;
    const { calls } = await showForm({
      "GET /api/registration": () => json({ open: true, tokenRequired: true, passkeys: false }),
      "POST /api/registration": () => {
        attempts += 1;
        return json({ error: { code: "setup_token_invalid" } }, 403);
      },
    });
    await userEvent.type(screen.getByLabelText("Username"), "owner");
    await userEvent.type(passwordInput(), "a long password here");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findAllByText("Enter the setup token.")).length).toBeGreaterThan(0);
    expect(attempts).toBe(0);
    await userEvent.type(screen.getByLabelText("Setup token"), " the-token ");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(
      (await screen.findAllByText("That is not this instance's setup token.")).length,
    ).toBeGreaterThan(0);
    expect(await sentBody(calls, "/api/registration")).toEqual({
      username: "owner",
      name: "",
      email: "",
      password: "a long password here",
      setupToken: "the-token",
    });
  });

  it("sends the setup token with an import too", async () => {
    const { router, calls } = await showForm({
      "GET /api/registration": () => json({ open: true, tokenRequired: true, passkeys: false }),
      "POST /api/registration/import": () => json({ user: 1 }, 201),
    });
    await userEvent.click(screen.getByRole("radio", { name: "From an export" }));
    const file = new File([JSON.stringify({ format: "davloom-export" })], "export.json", {
      type: "application/json",
    });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no file input");
    await userEvent.upload(input, file);
    await userEvent.type(screen.getByLabelText("Export key"), "the-key");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect((await screen.findAllByText("Enter the setup token.")).length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText("Setup token"), "the-token");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(await sentBody(calls, "/api/registration/import")).toEqual({
      key: "the-key",
      file: { format: "davloom-export" },
      setupToken: "the-token",
    });
  });

  describe("importing", () => {
    it("refuses a file that is not JSON, without sending it", async () => {
      const { calls } = await importForm();
      await upload("not json at all");
      await userEvent.type(screen.getByLabelText("Export key"), "the-key{Enter}");
      expect(await screen.findByText("That file is not a Davloom export.")).toBeTruthy();
      expect(calls.some((call) => call.url.endsWith("/api/registration/import"))).toBe(false);
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Import" }).disabled).toBe(
        false,
      );
    });

    it.each([
      [
        "the server's explanation",
        () =>
          json({ error: { code: "archive_invalid", message: "The key does not open it." } }, 400),
        "The key does not open it.",
      ],
      [
        "that the server could not be reached",
        () => Promise.reject(new TypeError("Failed to fetch")),
        "Davloom could not be reached. Check the connection and try again.",
      ],
    ])("shows %s when an import fails", async (_case, answer, message) => {
      const { router } = await importForm({ "POST /api/registration/import": answer });
      await upload(JSON.stringify({ format: "davloom-export" }));
      await userEvent.type(screen.getByLabelText("Export key"), "the-key");
      await userEvent.click(screen.getByRole("button", { name: "Import" }));
      expect(await screen.findByText(message)).toBeTruthy();
      expect(router.state.location.pathname).toBe("/register");
    });

    it("shows a refused setup token under its field, and forgets it once the token changes", async () => {
      await importForm({
        "GET /api/registration": () => json({ open: true, tokenRequired: true, passkeys: false }),
        "POST /api/registration/import": () =>
          json({ error: { code: "setup_token_invalid" } }, 403),
      });
      await upload(JSON.stringify({ format: "davloom-export" }));
      await userEvent.type(screen.getByLabelText("Export key"), "the-key");
      await userEvent.type(screen.getByLabelText("Setup token"), "wrong{Enter}");
      expect(
        (await screen.findAllByText("That is not this instance's setup token.")).length,
      ).toBeGreaterThan(0);
      expect(screen.getByLabelText("Setup token").getAttribute("aria-invalid")).toBe("true");
      await userEvent.type(screen.getByLabelText("Setup token"), "x");
      expect(screen.getByLabelText("Setup token").getAttribute("aria-invalid")).not.toBe("true");
    });

    it("forgets a missing file's problem once a file is chosen", async () => {
      await importForm();
      await userEvent.click(screen.getByRole("button", { name: "Import" }));
      expect((await screen.findAllByText("Choose the export file.")).length).toBeGreaterThan(0);
      await upload("{}");
      await waitFor(() => expect(screen.queryByText("Choose the export file.")).toBeNull());
    });
  });

  it("sends the form with Enter in any field, and forgets the setup token's problem", async () => {
    const { calls } = await showForm({
      "GET /api/registration": () => json({ open: true, tokenRequired: true, passkeys: false }),
    });
    await userEvent.type(screen.getByLabelText("Username"), "owner{Enter}");
    expect((await screen.findAllByText("Enter the setup token.")).length).toBeGreaterThan(0);
    await userEvent.type(passwordInput(), "short{Enter}");
    await userEvent.type(screen.getByLabelText("Setup token"), "t");
    expect(screen.queryByText("Enter the setup token.")).toBeNull();
    await userEvent.type(screen.getByLabelText("Setup token"), "{Enter}");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });
});

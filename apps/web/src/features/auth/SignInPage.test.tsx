import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderPage, type Handler } from "../../test/render";
import { SignInPage } from "./SignInPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ME = { id: "u", name: "Admin", email: "admin@davloom.test" };
const SIGNED_OUT = () => json({ error: { code: "unauthorized" } }, 401);
const SET_UP: Handler = () => json({ needed: false, open: false });

const showForm = async (api: Record<string, Handler> = {}, redirect?: string) => {
  const page = await renderPage(<SignInPage redirect={redirect} />, {
    path: "/sign-in",
    api: { "GET /api/me": SIGNED_OUT, "GET /api/setup": SET_UP, ...api },
  });
  await screen.findByRole("heading", { name: "Sign in" });
  return page;
};

const fill = async (email: string, password: string) => {
  if (email !== "") {
    await userEvent.type(screen.getByLabelText("Email"), email);
  }
  if (password !== "") {
    await userEvent.type(screen.getByLabelText("Password"), password);
  }
};

describe("SignInPage", () => {
  it("waits while it checks the session", async () => {
    await renderPage(<SignInPage />, {
      api: {
        "GET /api/me": () => new Promise<Response>(() => undefined),
        "GET /api/setup": SET_UP,
      },
    });
    expect(screen.getByText("Checking the session")).toBeTruthy();
  });

  it.each([
    [undefined, "/"],
    ["/files?path=%2Ffiles", "/files?path=%2Ffiles"],
    ["//evil.example", "/"],
  ])("a signed-in visit with redirect %j opens %j", async (redirect, href) => {
    const { router } = await renderPage(<SignInPage redirect={redirect} />, {
      path: "/sign-in",
      api: { "GET /api/me": () => json(ME), "GET /api/setup": SET_UP },
    });
    await waitFor(() => expect(router.state.location.href).toBe(href));
  });

  it("sends an instance that needs setup to the setup page", async () => {
    const { router } = await renderPage(<SignInPage />, {
      path: "/sign-in",
      api: {
        "GET /api/me": SIGNED_OUT,
        "GET /api/setup": () => json({ needed: true, open: true }),
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/setup"));
  });

  it.each([
    ["", "", ["Enter the email you set up Davloom with.", "Enter your password."]],
    ["   ", "secret", ["Enter the email you set up Davloom with."]],
    ["admin@davloom.test", "", ["Enter your password."]],
  ])("refuses email %j with password %j before sending", async (email, password, problems) => {
    const { calls } = await showForm();
    await fill(email, password);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    for (const problem of problems) {
      expect((await screen.findAllByText(problem)).length).toBeGreaterThan(0);
    }
    expect(calls.some((call) => call.url.endsWith("/api/auth/sign-in/email"))).toBe(false);
  });

  it("clears a field's problem once the field changes", async () => {
    await showForm();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your password.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Password"), "x");
    expect(screen.queryByText("Enter your password.")).toBeNull();
    await userEvent.type(screen.getByLabelText("Email"), "a");
    expect(screen.queryByText("Enter the email you set up Davloom with.")).toBeNull();
  });

  it.each([
    ["the button", undefined, "/"],
    ["Enter", "/credentials", "/credentials"],
    ["the button", "https://evil.example/", "/"],
  ])("signs in with %s and opens redirect %j at %j", async (how, redirect, href) => {
    let signedIn = false;
    const { router, calls } = await showForm(
      {
        "GET /api/me": () => (signedIn ? json(ME) : SIGNED_OUT()),
        "POST /api/auth/sign-in/email": () => {
          signedIn = true;
          return json({ ok: true });
        },
      },
      redirect,
    );
    await fill(" admin@davloom.test ", "correct horse");
    if (how === "Enter") {
      await userEvent.type(screen.getByLabelText("Password"), "{Enter}");
    } else {
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    }
    await waitFor(() => expect(router.state.location.href).toBe(href));
    const sent = calls.find((call) => call.url.endsWith("/api/auth/sign-in/email"));
    expect(await sent?.json()).toEqual({
      email: "admin@davloom.test",
      password: "correct horse",
    });
  });

  it.each([
    [json({ error: { code: "unauthorized" } }, 401), "The email or the password is wrong."],
    [
      json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "x" }, 403),
      "The email or the password is wrong.",
    ],
    [json({ error: { code: "boom" } }, 500), "The server refused the request (500)."],
  ])("says why a sign-in failed (%#)", async (response, message) => {
    await showForm({ "POST /api/auth/sign-in/email": () => response.clone() });
    await fill("admin@davloom.test", "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Sign in" }).disabled).toBe(false);
  });

  it("warns when the setup state cannot be read, and still offers the form", async () => {
    await showForm({ "GET /api/setup": () => json({ error: { code: "x" } }, 503) });
    expect(await screen.findByText("The server refused the request (503).")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });
});

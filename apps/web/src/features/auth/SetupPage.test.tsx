import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderPage, type Handler } from "../../test/render";
import { SetupPage } from "./SetupPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OPEN = () => json({ needed: true, open: true });

const showSetup = async (api: Record<string, Handler> = {}) => {
  const page = await renderPage(<SetupPage />, {
    path: "/setup",
    api: { "GET /api/setup": OPEN, ...api },
  });
  await screen.findByRole("heading", { name: "Set up Davloom" });
  return page;
};

const sentTo = async (calls: Request[], path: string): Promise<unknown> =>
  calls.find((call) => call.method === "POST" && new URL(call.url).pathname === path)?.json();

const VALID = {
  Name: "Admin",
  Email: "admin@davloom.test",
  Password: "correct horse battery",
  "Setup token": "token",
};

const fillNew = async (fields: Partial<Record<keyof typeof VALID, string>>) => {
  for (const [label, value] of Object.entries(fields)) {
    if (value !== "") {
      await userEvent.type(screen.getByLabelText(label), value);
    }
  }
};

const chooseImport = async () => {
  await userEvent.click(screen.getByRole("radio", { name: "From an export" }));
  await screen.findByRole("button", { name: "Import" });
};

const fileInput = (): HTMLInputElement => {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("no file input");
  }
  return input;
};

const exportFile = (text: string) => new File([text], "export.json", { type: "application/json" });

describe("SetupPage", () => {
  it("waits while it checks the instance", async () => {
    await renderPage(<SetupPage />, {
      api: { "GET /api/setup": () => new Promise<Response>(() => undefined) },
    });
    expect(screen.getByText("Checking this instance")).toBeTruthy();
  });

  it("sends an instance that is set up to sign in", async () => {
    const { router } = await renderPage(<SetupPage />, {
      path: "/setup",
      api: { "GET /api/setup": () => json({ needed: false, open: false }) },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
  });

  it.each([
    [
      "closed",
      () => json({ needed: true, open: false }),
      "Setup is closed",
      "Set DAVLOOM_SETUP_TOKEN on this deployment, then reload this page.",
    ],
    [
      "unreadable",
      () => json({ error: { code: "x" } }, 500),
      "The server refused the request (500).",
      undefined,
    ],
  ])("says when setup is %s and reads again on Try again", async (_, answer, title, detail) => {
    const { calls } = await renderPage(<SetupPage />, { api: { "GET /api/setup": answer } });
    expect(await screen.findByText(title)).toBeTruthy();
    if (detail !== undefined) {
      expect(screen.getByText(detail)).toBeTruthy();
    }
    const before = calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls.length).toBe(before + 1));
  });

  it("checks every field before sending", async () => {
    const { calls } = await showSetup();
    await fillNew({ Email: "nope", Password: "short" });
    await userEvent.click(screen.getByRole("button", { name: "Create administrator" }));
    for (const problem of [
      "Enter the name Davloom should call you.",
      "Enter an email address, such as you@example.com.",
      "Use at least 12 characters.",
      "Enter the setup token of this deployment.",
    ]) {
      expect((await screen.findAllByText(problem)).length).toBeGreaterThan(0);
    }
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    await userEvent.type(screen.getByLabelText("Name"), "A");
    expect(screen.queryByText("Enter the name Davloom should call you.")).toBeNull();
  });

  it("creates the administrator, signs in and opens the Overview", async () => {
    const { router, calls } = await showSetup({
      "POST /api/setup": () => json({ userId: "u" }),
      "POST /api/auth/sign-in/email": () => json({ ok: true }),
    });
    await fillNew({ ...VALID, Name: " Admin ", "Setup token": " token " });
    await userEvent.type(screen.getByLabelText("Setup token"), "{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await sentTo(calls, "/api/setup")).toEqual({
      name: "Admin",
      email: "admin@davloom.test",
      password: "correct horse battery",
      token: "token",
    });
    expect(await sentTo(calls, "/api/auth/sign-in/email")).toEqual({
      email: "admin@davloom.test",
      password: "correct horse battery",
    });
  });

  it.each([
    [
      "setup_token_invalid",
      403,
      "The setup token is wrong. It is the DAVLOOM_SETUP_TOKEN of this deployment.",
    ],
    ["setup_closed", 409, "Setup is already complete. Sign in instead."],
    ["invalid_input", 400, "The server refused one of the values. Check them and try again."],
    ["unauthorized", 401, "Your session has ended. Sign in again."],
  ])("says why setup failed with %s", async (code, status, message) => {
    await showSetup({ "POST /api/setup": () => json({ error: { code } }, status) });
    await fillNew(VALID);
    await userEvent.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("says something went wrong when the network fails", async () => {
    await showSetup({
      "POST /api/setup": () => {
        throw new TypeError("offline");
      },
    });
    await fillNew(VALID);
    await userEvent.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(
      await screen.findByText("Davloom could not be reached. Check the connection and try again."),
    ).toBeTruthy();
  });

  it("checks the import's fields before sending", async () => {
    const { calls } = await showSetup();
    await chooseImport();
    expect(
      screen.getByText(
        "Bring the administrator, keys, backends and mounts from an export of another instance.",
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    for (const problem of [
      "Choose the export file.",
      "Enter the key shown with the export.",
      "Enter the setup token.",
    ]) {
      expect((await screen.findAllByText(problem)).length).toBeGreaterThan(0);
    }
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    await userEvent.type(screen.getByLabelText("Export key"), "k");
    expect(screen.queryByText("Enter the key shown with the export.")).toBeNull();
    await userEvent.type(screen.getByLabelText("Setup token"), "t");
    expect(screen.queryByText("Enter the setup token.")).toBeNull();
    await userEvent.upload(fileInput(), exportFile("{}"));
    expect(screen.queryByText("Choose the export file.")).toBeNull();
  });

  it("switches back to a new instance", async () => {
    await showSetup();
    await chooseImport();
    await userEvent.click(screen.getByRole("radio", { name: "New instance" }));
    expect(await screen.findByRole("button", { name: "Create administrator" })).toBeTruthy();
  });

  it("imports an export and sends the administrator to sign in", async () => {
    const { router, calls } = await showSetup({
      "POST /api/setup/import": () => json({ keys: 1 }),
    });
    await chooseImport();
    await userEvent.upload(fileInput(), exportFile('{"format":"davloom-export"}'));
    await userEvent.type(screen.getByLabelText("Export key"), " dvx_key ");
    await userEvent.type(screen.getByLabelText("Setup token"), " token {Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(await sentTo(calls, "/api/setup/import")).toEqual({
      token: "token",
      key: "dvx_key",
      file: { format: "davloom-export" },
    });
  });

  it.each([
    ["a file that is not JSON", "not json", undefined, "That file is not a Davloom export."],
    [
      "an export the server refuses",
      "{}",
      () => json({ error: { code: "archive_invalid", message: "The key does not open it." } }, 400),
      "The key does not open it.",
    ],
    [
      "a wrong token",
      "{}",
      () => json({ error: { code: "setup_token_invalid" } }, 403),
      "The setup token is wrong. It is the DAVLOOM_SETUP_TOKEN of this deployment.",
    ],
  ])("says why an import of %s failed", async (_, text, answer, message) => {
    const { calls } = await showSetup(
      answer === undefined ? {} : { "POST /api/setup/import": answer },
    );
    await chooseImport();
    await userEvent.upload(fileInput(), exportFile(text));
    await userEvent.type(screen.getByLabelText("Export key"), "k");
    await userEvent.type(screen.getByLabelText("Setup token"), "t");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith("/api/setup/import"))).toBe(answer !== undefined);
  });
});

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderPage, type Handler } from "../../test/render";
import { api, apiCall } from "../api/client";
import { passkeyApi, stubPasskeys } from "../../test/webauthn";
import { StepUpDialog } from "./StepUpDialog";

// The step-up dialog as a page meets it: a request refused with verification_required opens it,
// and the request runs again once the person verified.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ME = (twoFactorEnabled: boolean) => () =>
  json({
    id: "u",
    name: "Owner",
    username: "owner",
    email: null,
    twoFactorEnabled,
    verifiedAt: 0,
  });

/** POST /api/keys answers verification_required until /api/verify accepts the person. */
const world = (extra: Record<string, Handler> = {}, twoFactorEnabled = false) => {
  let verified = false;
  const handlers: Record<string, Handler> = {
    "GET /api/me": ME(twoFactorEnabled),
    "POST /api/keys": () =>
      verified
        ? json({ id: "k", key: "dav_x" }, 201)
        : json({ error: { code: "verification_required" } }, 403),
    "POST /api/verify": async (request) => {
      const body: unknown = await request.json();
      const password = Reflect.get(Object(body), "password");
      if (password !== "my password") {
        return json({ error: { code: "wrong_password" } }, 400);
      }
      if (twoFactorEnabled && Reflect.get(Object(body), "code") !== "123456") {
        return json({ error: { code: "wrong_code" } }, 400);
      }
      verified = true;
      return json({ verified: true });
    },
    ...extra,
  };
  return handlers;
};

const show = async (handlers: Record<string, Handler>) => {
  const page = await renderPage(<StepUpDialog />, { api: handlers });
  await waitFor(() => expect(page.calls.some((call) => call.url.endsWith("/api/me"))).toBe(true));
  return page;
};

describe("StepUpDialog", () => {
  it("asks for the password, then runs the refused request again", async () => {
    const { calls } = await show(world());
    const created = apiCall(() => api.keys.post({}));
    const dialog = await screen.findByRole("dialog", { name: "Verify it is you" });
    expect(within(dialog).queryByLabelText("Authenticator code")).toBeNull();
    await userEvent.type(within(dialog).getByLabelText("Password"), "wrong password{Enter}");
    expect(await within(dialog).findByText("The password is wrong.")).toBeTruthy();
    await userEvent.clear(within(dialog).getByLabelText("Password"));
    await userEvent.type(within(dialog).getByLabelText("Password"), "my password");
    await userEvent.click(within(dialog).getByRole("button", { name: "Verify" }));
    expect(await created).toEqual({ id: "k", key: "dav_x" });
    expect(calls.filter((call) => call.url.endsWith("/api/keys"))).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks for the authenticator code too when two-step verification is on", async () => {
    await show(world({}, true));
    const created = apiCall(() => api.keys.post({}));
    const dialog = await screen.findByRole("dialog", { name: "Verify it is you" });
    await userEvent.type(within(dialog).getByLabelText("Password"), "my password{Enter}");
    expect(
      await within(dialog).findByText("Enter the code from your authenticator app."),
    ).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "000000{Enter}");
    expect(await within(dialog).findByText("The code is wrong or has expired.")).toBeTruthy();
    await userEvent.clear(within(dialog).getByLabelText("Authenticator code"));
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "123456{Enter}");
    expect(await created).toEqual({ id: "k", key: "dav_x" });
  });

  it("lets the refusal stand when the person cancels", async () => {
    const { calls } = await show(world());
    const refused = apiCall(() => api.keys.post({})).catch((error: unknown) => error);
    const dialog = await screen.findByRole("dialog", { name: "Verify it is you" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await refused).toMatchObject({ status: 403, code: "verification_required" });
    expect(calls.some((call) => call.url.endsWith("/api/verify"))).toBe(false);
  });

  it("verifies with a passkey, then runs the refused request again", async () => {
    const credentials = stubPasskeys();
    let verified = false;
    const { calls } = await show(
      world({
        ...passkeyApi({
          authentication: () => {
            verified = true;
            return json({ session: { token: "new" }, user: { id: "u" } });
          },
        }),
        "POST /api/keys": () =>
          verified
            ? json({ id: "k", key: "dav_x" }, 201)
            : json({ error: { code: "verification_required" } }, 403),
      }),
    );
    const created = apiCall(() => api.keys.post({}));
    const dialog = await screen.findByRole("dialog", { name: "Verify it is you" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Use a passkey" }));
    expect(await created).toEqual({ id: "k", key: "dav_x" });
    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.url.endsWith("/passkey/verify-authentication"))).toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it.each([
    ["the person cancels the passkey prompt", { cancel: true }, {}, "Auth cancelled"],
    [
      "the server refuses the passkey",
      {},
      {
        authentication: () =>
          json({ code: "PASSKEY_NOT_FOUND", message: "Passkey not found" }, 401),
      },
      "Passkey not found",
    ],
  ])("says so when %s, and keeps the dialog open", async (_, browser, server, shown) => {
    stubPasskeys(browser);
    await show(world(passkeyApi(server)));
    const refused = apiCall(() => api.keys.post({})).catch((error: unknown) => error);
    const dialog = await screen.findByRole("dialog", { name: "Verify it is you" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Use a passkey" }));
    expect(await within(dialog).findByText(shown)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await refused).toMatchObject({ code: "verification_required" });
  });

  it.each([
    ["code_required", "Enter the code from your authenticator app."],
    [
      "too_many_attempts_request_new_code",
      "Too many wrong codes. Wait a few minutes and try again.",
    ],
    ["account_temporarily_locked", "Too many wrong codes. Wait a few minutes and try again."],
    ["verification_locked", "Too many wrong attempts. Wait 15 minutes, then try again."],
  ])("explains the refusal %s", async (code, message) => {
    await show(world({ "POST /api/verify": () => json({ error: { code } }, 400) }));
    const refused = apiCall(() => api.keys.post({})).catch((error: unknown) => error);
    const dialog = await screen.findByRole("dialog", { name: "Verify it is you" });
    await userEvent.type(within(dialog).getByLabelText("Password"), "my password{Enter}");
    expect(await within(dialog).findByText(message)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await refused).toMatchObject({ code: "verification_required" });
  });

  it("lets the refusal stand when the person closes the dialog with Escape", async () => {
    await show(world());
    const refused = apiCall(() => api.keys.post({})).catch((error: unknown) => error);
    await screen.findByRole("dialog", { name: "Verify it is you" });
    await userEvent.keyboard("{Escape}");
    expect(await refused).toMatchObject({ status: 403, code: "verification_required" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("refuses an empty password before sending", async () => {
    const { calls } = await show(world());
    void apiCall(() => api.keys.post({})).catch(() => undefined);
    const dialog = await screen.findByRole("dialog", { name: "Verify it is you" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Verify" }));
    expect(await within(dialog).findByText("Enter your password.")).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith("/api/verify"))).toBe(false);
  });
});

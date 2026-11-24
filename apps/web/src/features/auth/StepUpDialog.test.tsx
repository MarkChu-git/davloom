import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderPage, type Handler } from "../../test/render";
import { apiFetch } from "../api/client";
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
const world = (api: Record<string, Handler> = {}, twoFactorEnabled = false) => {
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
    ...api,
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
    const created = apiFetch<{ key: string }>("/api/keys", { method: "POST", body: {} });
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
    const created = apiFetch("/api/keys", { method: "POST", body: {} });
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
    const refused = apiFetch("/api/keys", { method: "POST", body: {} }).catch(
      (error: unknown) => error,
    );
    const dialog = await screen.findByRole("dialog", { name: "Verify it is you" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await refused).toMatchObject({ status: 403, code: "verification_required" });
    expect(calls.some((call) => call.url.endsWith("/api/verify"))).toBe(false);
  });

  it("refuses an empty password before sending", async () => {
    const { calls } = await show(world());
    void apiFetch("/api/keys", { method: "POST", body: {} }).catch(() => undefined);
    const dialog = await screen.findByRole("dialog", { name: "Verify it is you" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Verify" }));
    expect(await within(dialog).findByText("Enter your password.")).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith("/api/verify"))).toBe(false);
  });
});

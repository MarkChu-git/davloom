import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderPage, type Handler } from "../../test/render";
import { passkeyApi, stubPasskeys } from "../../test/webauthn";
import { SettingsPage } from "./SettingsPage";

// Settings > Sign-in and security: what each dialog refuses before sending, what it says when the
// server refuses, and passkeys and sessions when a change fails.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ME = {
  id: "u",
  name: "Ada Lovelace",
  username: "ada",
  email: "ada@example.com",
  twoFactorEnabled: false,
  verifiedAt: 0,
};

const SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

const session = (token: string, userAgent: string) => ({
  id: `id-${token}`,
  token,
  createdAt: "2026-11-20T00:00:00Z",
  updatedAt: "2026-11-22T00:00:00Z",
  expiresAt: "2026-12-20T00:00:00Z",
  ipAddress: null,
  userAgent,
});

const securityApi = (overrides: Record<string, Handler> = {}): Record<string, Handler> => ({
  "GET /api/me": () => json(ME),
  "GET /api/registration": () => json({ open: false, tokenRequired: false, passkeys: true }),
  "GET /api/auth/passkey/list-user-passkeys": () => json([]),
  "GET /api/auth/list-sessions": () => json([session("here", SAFARI), session("there", FIREFOX)]),
  "GET /api/auth/get-session": () => json({ session: { token: "here" }, user: {} }),
  ...overrides,
});

const show = async (overrides: Record<string, Handler> = {}, shown = "Sessions") => {
  const page = await renderPage(<SettingsPage section="security" />, {
    path: "/settings?section=security",
    api: securityApi(overrides),
  });
  await screen.findByText(shown);
  return page;
};

const refused =
  (code: string, status = 400) =>
  () =>
    json({ code: code.toUpperCase(), message: "Refused" }, status);

const TOTP_URI = "otpauth://totp/Davloom:ada?secret=JBSWY3DPEHPK3PXP&issuer=Davloom";

/** Opens the authenticator step of setting up two-step verification. */
const scanStep = async (verify: Handler) => {
  const page = await show({
    "POST /api/auth/two-factor/enable": () => json({ totpURI: TOTP_URI, backupCodes: ["a-b"] }),
    "POST /api/auth/two-factor/verify-totp": verify,
  });
  await userEvent.click(screen.getByRole("button", { name: "Set up" }));
  const dialog = await screen.findByRole("dialog", { name: "Set up two-step verification" });
  await userEvent.type(within(dialog).getByLabelText("Password"), "my password{Enter}");
  await within(dialog).findByAltText("QR code for the authenticator app");
  return { ...page, dialog };
};

describe("the password dialog", () => {
  it("asks for the current password, and forgets the problem once it is typed", async () => {
    const { calls } = await show();
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog", { name: "Change password" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await within(dialog).findByText("Enter your current password.")).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Current password"), "o");
    expect(within(dialog).queryByText("Enter your current password.")).toBeNull();
    expect(calls.some((call) => call.url.endsWith("/change-password"))).toBe(false);
  });

  it("sends with Enter in the current password, and closes on Cancel without a change", async () => {
    const { calls } = await show({
      "POST /api/auth/change-password": () => json({ token: null }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog", { name: "Change password" });
    await userEvent.type(within(dialog).getByLabelText("Current password"), "old{Enter}");
    expect(calls.some((call) => call.url.endsWith("/change-password"))).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Password changed.")).toBeNull();
  });
});

describe("the password step of two-step verification", () => {
  it.each([
    ["no password", "", undefined, "Enter your password."],
    ["a wrong password", "nope", refused("invalid_password"), "The password is wrong."],
    [
      "a failure of the server",
      "my password",
      () => json({ error: { code: "boom" } }, 500),
      "The server refused the request (500).",
    ],
  ])("refuses %s", async (_case, password, answer, message) => {
    const { calls } = await show(
      answer === undefined ? {} : { "POST /api/auth/two-factor/enable": answer },
    );
    await userEvent.click(screen.getByRole("button", { name: "Set up" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up two-step verification" });
    if (password !== "") await userEvent.type(within(dialog).getByLabelText("Password"), password);
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText(message)).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith("/two-factor/enable"))).toBe(
      answer !== undefined,
    );
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", { name: "Continue" }).disabled,
    ).toBe(false);
  });

  it("closes on Cancel", async () => {
    await show();
    await userEvent.click(screen.getByRole("button", { name: "Set up" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up two-step verification" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("the authenticator step", () => {
  it("asks for a code before sending, and forgets the problem once one is typed", async () => {
    const { dialog, calls } = await scanStep(() => json({ token: "t" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Turn on" }));
    expect(
      (await within(dialog).findAllByText("Enter the code from your authenticator app.")).length,
    ).toBeGreaterThan(0);
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "1");
    expect(within(dialog).queryByText("Enter the code from your authenticator app.")).toBeNull();
    expect(calls.some((call) => call.url.endsWith("/two-factor/verify-totp"))).toBe(false);
  });

  it.each([
    [refused("invalid_code", 401), "The code is wrong or has expired."],
    [() => json({ error: { code: "boom" } }, 500), "The server refused the request (500)."],
  ])("says why a code failed (%#)", async (answer, message) => {
    const { dialog } = await scanStep(answer);
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "000000{Enter}");
    expect(await within(dialog).findByText(message)).toBeTruthy();
    expect(screen.queryByText("Two-step verification is on.")).toBeNull();
  });

  it("closes on Cancel and leaves two-step verification off", async () => {
    const { dialog } = await scanStep(() => json({ token: "t" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Off")).toBeTruthy();
  });
});

describe("passkeys", () => {
  it("adds a passkey of this device", async () => {
    const credentials = stubPasskeys();
    const { calls } = await show(passkeyApi(), "None");
    await userEvent.click(screen.getByRole("button", { name: "Add passkey" }));
    expect((await screen.findAllByText("Passkey added.")).length).toBeGreaterThan(0);
    expect(credentials.create).toHaveBeenCalledTimes(1);
    const options = calls.find((call) => call.url.includes("/passkey/generate-register-options"));
    expect(new URL(options?.url ?? "http://x").searchParams.get("name")).toBeTruthy();
  });

  it("says why a passkey could not be added", async () => {
    stubPasskeys();
    await show(
      passkeyApi({
        registration: () =>
          json({ code: "FAILED_TO_VERIFY_REGISTRATION", message: "Failed to verify" }, 400),
      }),
      "None",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add passkey" }));
    expect((await screen.findAllByText("Failed to verify")).length).toBeGreaterThan(0);
  });

  it("offers no Add passkey in a browser without passkeys", async () => {
    await show({}, "None");
    expect(screen.getByText("Passkeys")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add passkey" })).toBeNull();
  });

  it("names a passkey without a name or a date, and says why removing it failed", async () => {
    await show(
      {
        "GET /api/auth/passkey/list-user-passkeys": () =>
          json([{ id: "pk", name: null, createdAt: null, deviceType: "x", backedUp: false }]),
        "POST /api/auth/passkey/delete-passkey": () => json({ error: { code: "boom" } }, 500),
      },
      "Passkey",
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Passkey" }));
    expect(
      (await screen.findAllByText("The server refused the request (500).")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Remove Passkey" })).toBeTruthy();
  });

  it("says when the passkeys cannot be read", async () => {
    await show(
      { "GET /api/auth/passkey/list-user-passkeys": () => json({ error: { code: "x" } }, 503) },
      "Cannot read the passkeys",
    );
  });
});

describe("sessions", () => {
  it("moves the focus to the next device after signing one out", async () => {
    let revoked: string[] = [];
    await show({
      "GET /api/auth/list-sessions": () =>
        json(
          [
            session("here", SAFARI),
            session("there", FIREFOX),
            session("phone", CHROME_ANDROID),
          ].filter((item) => !revoked.includes(item.token)),
        ),
      "POST /api/auth/revoke-session": async (request) => {
        const body: unknown = await request.json();
        revoked = [...revoked, String(Reflect.get(Object(body), "token"))];
        return json({ status: true });
      },
    });
    const first = await screen.findByRole("button", { name: "Sign out Firefox on Windows" });
    first.focus();
    await userEvent.click(first);
    expect((await screen.findAllByText("Signed out Firefox on Windows.")).length).toBeGreaterThan(
      0,
    );
    await waitFor(() => expect(revoked).toEqual(["there"]));
    const last = await screen.findByRole("button", { name: /^Sign out Chrome/ });
    await userEvent.click(last);
    await waitFor(() => expect(revoked).toEqual(["there", "phone"]));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Sign out Chrome/ })).toBeNull(),
    );
  });

  it("says why a device could not be signed out", async () => {
    await show({
      "POST /api/auth/revoke-session": () => json({ error: { code: "boom" } }, 500),
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out Firefox on Windows" }),
    );
    expect(
      (await screen.findAllByText("The server refused the request (500).")).length,
    ).toBeGreaterThan(0);
  });

  it("lists only other devices when this browser's session is not among them", async () => {
    await show({
      "GET /api/auth/get-session": () => json(null),
    });
    expect(await screen.findByRole("button", { name: "Sign out Firefox on Windows" })).toBeTruthy();
    expect(screen.queryByText("Active now, this browser")).toBeNull();
  });
});

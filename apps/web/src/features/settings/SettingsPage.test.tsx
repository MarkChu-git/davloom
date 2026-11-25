import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectChinese } from "../../test/chinese";
import { json, renderPage, type Handler } from "../../test/render";
import { SettingsPage } from "./SettingsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

const session = (token: string, userAgent: string) => ({
  id: `id-${token}`,
  token,
  createdAt: "2026-11-20T00:00:00Z",
  updatedAt: "2026-11-22T00:00:00Z",
  expiresAt: "2026-12-20T00:00:00Z",
  ipAddress: null,
  userAgent,
});

/** The answers the security section reads: the owner, passkeys and sessions. */
const securityApi = (overrides: Record<string, Handler> = {}): Record<string, Handler> => ({
  "GET /api/me": () => json(ME),
  "GET /api/registration": () => json({ open: false, tokenRequired: false, passkeys: true }),
  "GET /api/auth/passkey/list-user-passkeys": () =>
    json([
      {
        id: "pk1",
        name: "Safari on macOS",
        createdAt: "2026-11-01T00:00:00Z",
        deviceType: "multiDevice",
        backedUp: true,
      },
    ]),
  "GET /api/auth/list-sessions": () => json([session("here", SAFARI), session("there", FIREFOX)]),
  "GET /api/auth/get-session": () => json({ session: { token: "here" }, user: {} }),
  ...overrides,
});

const showSecurity = async (overrides: Record<string, Handler> = {}) => {
  const page = await renderPage(<SettingsPage section="security" />, {
    path: "/settings?section=security",
    api: securityApi(overrides),
  });
  await screen.findByText("Firefox on Windows");
  return page;
};

/** The new-password field of a dialog, whose group also names its Generate and Copy buttons. */
const newPassword = (dialog: HTMLElement): HTMLInputElement => {
  const input = dialog.querySelector<HTMLInputElement>('input[autocomplete="new-password"]');
  if (input === null) throw new Error("no new-password field");
  return input;
};

const sentBody = async (calls: Request[], path: string): Promise<unknown> =>
  await calls.find((call) => call.url.endsWith(path))?.json();

const backend = (kind: string, available = true) => ({
  id: kind,
  name: kind,
  kind,
  createdAt: "2026-11-01T00:00:00Z",
  available,
  usage: null,
});

/** The text of a detail's row: its label and its value. */
const value = (label: string) =>
  screen.getByText(label).closest("[class]")?.parentElement?.textContent;

describe("SettingsPage", () => {
  it("shows the profile in a form, and saves the display name", async () => {
    const { calls } = await renderPage(<SettingsPage section="profile" />, {
      path: "/settings?section=profile",
      api: {
        "GET /api/me": () => json(ME),
        "POST /api/auth/update-user": () => json({ status: true }),
      },
    });
    const name = await screen.findByLabelText<HTMLInputElement>("Display name");
    expect(name.value).toBe("Ada Lovelace");
    expect(screen.getByLabelText<HTMLInputElement>("Username").value).toBe("ada");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: /^Email/ }).value).toBe(
      "ada@example.com",
    );
    await userEvent.clear(name);
    await userEvent.type(name, "Ada King");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect((await screen.findAllByText("Profile saved.")).length).toBeGreaterThan(0);
    expect(await sentBody(calls, "/api/auth/update-user")).toEqual({ name: "Ada King" });
    expect(calls.some((call) => call.url.endsWith("/api/auth/change-email"))).toBe(false);
  });

  it("sends a new username and a new email", async () => {
    const { calls } = await renderPage(<SettingsPage section="profile" />, {
      api: {
        "GET /api/me": () => json(ME),
        "POST /api/auth/update-user": () => json({ status: true }),
        "POST /api/auth/change-email": () => json({ status: true }),
      },
    });
    const username = await screen.findByLabelText("Username");
    await userEvent.clear(username);
    await userEvent.type(username, "countess");
    const email = screen.getByRole("textbox", { name: /^Email/ });
    await userEvent.clear(email);
    await userEvent.type(email, "ada@lovelace.example");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect((await screen.findAllByText("Profile saved.")).length).toBeGreaterThan(0);
    expect(await sentBody(calls, "/api/auth/update-user")).toEqual({
      name: "Ada Lovelace",
      username: "countess",
    });
    expect(await sentBody(calls, "/api/auth/change-email")).toEqual({
      newEmail: "ada@lovelace.example",
    });
  });

  it.each([
    ["Display name", "", "Enter the name Davloom should call you."],
    ["Username", "a b", "Use 3 to 30 letters, digits, dots or underscores."],
    [/^Email/, "nope", "Enter an email address, such as you@example.com."],
  ])("refuses a %s of %j before sending", async (label, typed, problem) => {
    const { calls } = await renderPage(<SettingsPage section="profile" />, {
      api: { "GET /api/me": () => json(ME) },
    });
    const field = await screen.findByLabelText(label);
    await userEvent.clear(field);
    if (typed !== "") {
      await userEvent.type(field, typed);
    }
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect((await screen.findAllByText(problem)).length).toBeGreaterThan(0);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("shows why the server refused the profile", async () => {
    await renderPage(<SettingsPage section="profile" />, {
      api: {
        "GET /api/me": () => json(ME),
        "POST /api/auth/update-user": () =>
          json({ code: "USERNAME_IS_ALREADY_TAKEN", message: "Username is already taken." }, 400),
      },
    });
    const username = await screen.findByLabelText("Username");
    await userEvent.clear(username);
    await userEvent.type(username, "taken");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect((await screen.findAllByText("Username is already taken.")).length).toBeGreaterThan(0);
  });

  it("exports, downloads the file and shows the key", async () => {
    const created: string[] = [];
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }),
    );
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      created.push(this.download);
    };
    await renderPage(<SettingsPage section="export" />, {
      api: {
        "POST /api/export": () => json({ key: "dvx_abc", file: { format: "davloom-export" } }),
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText("The export is in your downloads")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Export key" }).value).toBe(
      "dvx_abc",
    );
    expect(created[0]).toMatch(/^davloom-export-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("says when the profile cannot be read", async () => {
    await renderPage(<SettingsPage section="profile" />, {
      api: { "GET /api/me": () => json({ error: { code: "not_found" } }, 404) },
    });
    expect(await screen.findByText("Cannot read the profile")).toBeTruthy();
    expect(screen.getByText("It is no longer there.")).toBeTruthy();
  });

  it.each([
    ["the server ends the session", () => json({ ok: true })],
    ["the session had already ended", () => json({ error: { code: "unauthorized" } }, 401)],
  ])("signs this browser out, once confirmed, when %s", async (_, answer) => {
    const { router, client, calls } = await showSecurity({ "POST /api/auth/sign-out": answer });
    expect(screen.getByRole("heading", { level: 2, name: "Sign-in and security" })).toBeTruthy();
    expect(screen.getByText("Active now, this browser")).toBeTruthy();
    const clear = vi.spyOn(client, "clear");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(clear).toHaveBeenCalledOnce();
    expect(calls.some((call) => call.url.endsWith("/api/auth/sign-out"))).toBe(true);
  });

  it("lists the sessions, and signs another device out", async () => {
    let revoked = false;
    const { calls } = await showSecurity({
      "GET /api/auth/list-sessions": () =>
        json(
          revoked
            ? [session("here", SAFARI)]
            : [session("here", SAFARI), session("there", FIREFOX)],
        ),
      "POST /api/auth/revoke-session": () => {
        revoked = true;
        return json({ status: true });
      },
    });
    expect(screen.getAllByText("Safari on macOS").length).toBe(2);
    await userEvent.click(screen.getByRole("button", { name: "Sign out Firefox on Windows" }));
    expect((await screen.findAllByText("Signed out Firefox on Windows.")).length).toBeGreaterThan(
      0,
    );
    expect(await sentBody(calls, "/api/auth/revoke-session")).toEqual({ token: "there" });
    await waitFor(() => expect(screen.queryByText("Firefox on Windows")).toBeNull());
  });

  it("changes the password, with a generated one the person can copy", async () => {
    const { calls } = await showSecurity({
      "POST /api/auth/change-password": () => json({ token: null }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog", { name: "Change password" });
    await userEvent.type(within(dialog).getByLabelText("Current password"), "the old password");
    await userEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
    const generated = newPassword(dialog);
    expect(generated.type).toBe("text");
    expect(generated.value).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(within(dialog).getByRole("button", { name: "Copy" })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect((await screen.findAllByText("Password changed.")).length).toBeGreaterThan(0);
    expect(await sentBody(calls, "/api/auth/change-password")).toEqual({
      currentPassword: "the old password",
      newPassword: generated.value,
      revokeOtherSessions: false,
    });
  });

  it.each([
    [
      json(
        {
          code: "PASSWORD_COMPROMISED",
          message: "This password appears in known data breaches. Choose another.",
        },
        400,
      ),
      "This password appears in known data breaches. Choose another.",
    ],
    [
      json({ code: "INVALID_PASSWORD", message: "Invalid password" }, 400),
      "The password is wrong.",
    ],
  ])("says why a password change failed (%#)", async (answer, message) => {
    await showSecurity({ "POST /api/auth/change-password": () => answer.clone() });
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Current password"), "the old password");
    await userEvent.type(newPassword(dialog), "a new long password");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await within(dialog).findByText(message)).toBeTruthy();
  });

  it("refuses a short new password before sending", async () => {
    const { calls } = await showSecurity();
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Current password"), "old");
    await userEvent.type(newPassword(dialog), "short");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await within(dialog).findByText("Use at least 12 characters.")).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith("/change-password"))).toBe(false);
  });

  it("sets up two-step verification: password, QR code and code, then backup codes", async () => {
    const { calls } = await showSecurity({
      "POST /api/auth/two-factor/enable": () =>
        json({
          totpURI: "otpauth://totp/Davloom:ada?secret=JBSWY3DPEHPK3PXP&issuer=Davloom",
          backupCodes: ["aaaa-bbbb", "cccc-dddd"],
        }),
      "POST /api/auth/two-factor/verify-totp": () => json({ token: "t" }),
    });
    expect(screen.getByText("Off")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Set up" }));
    let dialog = await screen.findByRole("dialog", { name: "Set up two-step verification" });
    await userEvent.type(within(dialog).getByLabelText("Password"), "my password{Enter}");
    expect(await within(dialog).findByAltText("QR code for the authenticator app")).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>("textbox", { name: "Setup key" }).value).toBe(
      "JBSWY3DPEHPK3PXP",
    );
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "123456");
    await userEvent.click(within(dialog).getByRole("button", { name: "Turn on" }));
    expect((await screen.findAllByText("Two-step verification is on.")).length).toBeGreaterThan(0);
    // The codes show once, so only Done closes their dialog.
    dialog = await screen.findByRole("alertdialog", { name: "Backup codes" });
    expect(
      within(dialog).getByRole<HTMLInputElement>("textbox", { name: "Backup codes" }).value,
    ).toBe("aaaa-bbbb cccc-dddd");
    expect(await sentBody(calls, "/two-factor/enable")).toEqual({ password: "my password" });
    expect(await sentBody(calls, "/two-factor/verify-totp")).toEqual({ code: "123456" });
  });

  it("turns two-step verification off with the password", async () => {
    let isOn = true;
    const { calls } = await showSecurity({
      "GET /api/me": () => json({ ...ME, twoFactorEnabled: isOn }),
      "POST /api/auth/two-factor/disable": () => {
        isOn = false;
        return json({ status: true });
      },
    });
    expect(await screen.findByText("On")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Password"), "my password");
    await userEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));
    expect((await screen.findAllByText("Two-step verification is off.")).length).toBeGreaterThan(0);
    expect(await sentBody(calls, "/two-factor/disable")).toEqual({ password: "my password" });
    expect(await screen.findByRole("button", { name: "Set up" })).toBeTruthy();
  });

  it("makes new backup codes", async () => {
    await showSecurity({
      "GET /api/me": () => json({ ...ME, twoFactorEnabled: true }),
      "POST /api/auth/two-factor/generate-backup-codes": () =>
        json({ status: true, backupCodes: ["1111-2222"] }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "New backup codes" }));
    let dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Password"), "my password{Enter}");
    dialog = await screen.findByRole("alertdialog");
    expect(
      (await within(dialog).findByRole<HTMLInputElement>("textbox", { name: "Backup codes" }))
        .value,
    ).toBe("1111-2222");
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("says passkeys are off on an instance without DAVLOOM_URL, and does not ask for them", async () => {
    const { calls } = await showSecurity({
      "GET /api/registration": () => json({ open: false, tokenRequired: false, passkeys: false }),
    });
    expect(await screen.findByText("Off: DAVLOOM_URL is not set")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add passkey" })).toBeNull();
    expect(calls.some((call) => call.url.includes("/passkey/"))).toBe(false);
  });

  it("lists the passkeys and removes one", async () => {
    let removed = false;
    const { calls } = await showSecurity({
      "GET /api/auth/passkey/list-user-passkeys": () =>
        json(
          removed
            ? []
            : [
                {
                  id: "pk1",
                  name: "YubiKey",
                  createdAt: "2026-11-01T00:00:00Z",
                  deviceType: "singleDevice",
                  backedUp: false,
                },
              ],
        ),
      "POST /api/auth/passkey/delete-passkey": () => {
        removed = true;
        return json({ status: true });
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Remove YubiKey" }));
    expect((await screen.findAllByText("Removed YubiKey.")).length).toBeGreaterThan(0);
    expect(await sentBody(calls, "/passkey/delete-passkey")).toEqual({ id: "pk1" });
    expect(await screen.findByText("None")).toBeTruthy();
  });

  it("switches the appearance", async () => {
    await renderPage(<SettingsPage section="appearance" />);
    const dark = screen.getByRole("radio", { name: "Dark" });
    await userEvent.click(dark);
    expect(dark.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getAllByRole("radio", { name: "System" })[0]!);
    expect(dark.getAttribute("aria-checked")).toBe("false");
  });

  it("switches the language and remembers it", async () => {
    await renderPage(<SettingsPage section="appearance" />);
    const group = screen.getByRole("radiogroup", { name: "Language" });
    await userEvent.click(within(group).getByRole("radio", { name: "简体中文" }));
    expect(localStorage.getItem("davloom-language")).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    await userEvent.click(within(group).getByRole("radio", { name: "System" }));
    expect(localStorage.getItem("davloom-language")).toBeNull();
  });

  it("gives the WebDAV address and how to connect", async () => {
    await renderPage(<SettingsPage section="webdav" />);
    const address = `${location.origin}/dav/`;
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Address" }).value).toBe(address);
    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();
    expect(screen.getByText("An API key")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Credentials" }).getAttribute("href")).toBe(
      "/credentials",
    );
  });

  it.each([
    [[backend("durable-object")], [{}], "Cloudflare Durable Objects", "1", "1"],
    [
      [backend("durable-object"), backend("durable-object", false), backend("s3")],
      [],
      "Cloudflare Durable Objects, S3 compatible",
      "3",
      "0",
    ],
    [[], [], "None", "0", "0"],
  ])("tells about the instance (%#)", async (backends, mounts, storage, count, mountCount) => {
    await renderPage(<SettingsPage section="about" />, {
      api: {
        "GET /api/backends": () => json(backends),
        "GET /api/mounts": () => json(mounts),
      },
    });
    expect(await screen.findByText(storage)).toBeTruthy();
    expect(value("Backends")).toContain(count);
    await waitFor(() => expect(value("Mounts")).toContain(mountCount));
    expect(screen.getByText(location.origin)).toBeTruthy();
    expect(screen.getByText(`${location.origin}/dav/`)).toBeTruthy();
  });

  it("shows … for what it has not read yet", async () => {
    await renderPage(<SettingsPage section="about" />, {
      api: {
        "GET /api/backends": () => new Promise<Response>(() => undefined),
        "GET /api/mounts": () => new Promise<Response>(() => undefined),
        "GET /api/instance": () => new Promise<Response>(() => undefined),
      },
    });
    expect(screen.getAllByText("…")).toHaveLength(9);
  });

  it("offers the sections in a selector on a narrow page, and opens the chosen one", async () => {
    const { router } = await renderPage(<SettingsPage section="profile" />, {
      path: "/settings?section=profile",
      api: { "GET /api/me": () => json(ME) },
    });
    expect(screen.queryByRole("navigation", { name: "Settings sections" })).toBeNull();
    await userEvent.click(screen.getByRole("combobox", { name: "Section" }));
    expect(await screen.findByRole("option", { name: "Data export" })).toBeTruthy();
    // In happy-dom a click on an option closes the listbox without choosing it, so the keys do.
    await userEvent.keyboard(
      "{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}",
    );
    await waitFor(() => expect(router.state.location.href).toBe("/settings?section=export"));
  });

  it("lists the sections beside the chosen one on a wide page", async () => {
    vi.stubGlobal("innerWidth", 1400);
    const { router } = await renderPage(<SettingsPage section="webdav" />, {
      path: "/settings?section=webdav",
    });
    const list = screen.getByRole("navigation", { name: "Settings sections" });
    expect(screen.queryByRole("combobox", { name: "Section" })).toBeNull();
    const links = within(list).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Profile",
      "Sign-in and security",
      "Activity",
      "Appearance",
      "WebDAV",
      "Storage",
      "Data export",
      "About this instance",
    ]);
    await userEvent.click(within(list).getByRole("link", { name: "About this instance" }));
    await waitFor(() => expect(router.state.location.href).toBe("/settings?section=about"));
  });

  it("exports again after a first export", async () => {
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }),
    );
    HTMLAnchorElement.prototype.click = () => undefined;
    let count = 0;
    await renderPage(<SettingsPage section="export" />, {
      api: {
        "POST /api/export": () => {
          count += 1;
          return json({ key: `dvx_${count}`, file: {} });
        },
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(await screen.findByRole("button", { name: "Export again" }));
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Export key" }).value).toBe(
        "dvx_2",
      ),
    );
  });

  it("says why an export failed", async () => {
    await renderPage(<SettingsPage section="export" />, {
      api: { "POST /api/export": () => json({ error: { code: "unauthorized" } }, 401) },
    });
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() =>
      expect(screen.getByText("Your session has ended. Sign in again.")).toBeTruthy(),
    );
  });
});

describe("SettingsPage in Chinese", () => {
  it.each(["profile", "security", "appearance", "webdav"] as const)(
    "writes the %s section in Chinese",
    async (section) => {
      const { container } = await renderPage(<SettingsPage section={section} />, {
        path: `/settings?section=${section}`,
        locale: "zh-CN",
        api: securityApi(),
      });
      expect(await screen.findByRole("heading", { level: 1, name: "设置" })).toBeTruthy();
      if (section === "security") {
        await screen.findByText("Windows 上的 Firefox");
      }
      expectChinese(container, [
        "English",
        "Ada Lovelace",
        "ada@example.com",
        "ada",
        "Safari",
        "macOS",
        "Firefox",
        "Windows",
        `${location.origin}/dav/`,
        // rclone's own settings, which a reader types as they are.
        "webdav",
        "vendor",
        "other",
      ]);
    },
  );
});

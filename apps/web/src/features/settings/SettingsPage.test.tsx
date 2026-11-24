import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderPage } from "../../test/render";
import { SettingsPage } from "./SettingsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ME = { id: "u", name: "Admin", email: "admin@davloom.test" };

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
  it("shows the profile", async () => {
    await renderPage(<SettingsPage section="profile" />, {
      path: "/settings?section=profile",
      api: { "GET /api/me": () => json(ME) },
    });
    expect(await screen.findByText("admin@davloom.test")).toBeTruthy();
    expect(screen.getByText("Administrator")).toBeTruthy();
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
  ])("signs this browser out when %s", async (_, answer) => {
    const { router, client, calls } = await renderPage(<SettingsPage section="security" />, {
      path: "/settings?section=security",
      api: { "POST /api/auth/sign-out": answer },
    });
    expect(screen.getByRole("heading", { level: 2, name: "Sign-in and security" })).toBeTruthy();
    expect(screen.getByText("Signed in")).toBeTruthy();
    const clear = vi.spyOn(client, "clear");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(clear).toHaveBeenCalledOnce();
    expect(calls.some((call) => call.url.endsWith("/api/auth/sign-out"))).toBe(true);
  });

  it("switches the appearance", async () => {
    await renderPage(<SettingsPage section="appearance" />);
    const dark = screen.getByRole("radio", { name: "Dark" });
    await userEvent.click(dark);
    expect(dark.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("radio", { name: "System" }));
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
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
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

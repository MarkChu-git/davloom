import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectChinese } from "../../test/chinese";
import { json, renderPage, type Handler } from "../../test/render";
import { DashboardShell } from "./DashboardShell";

let animate = vi.spyOn(Element.prototype, "animate");

beforeEach(() => {
  localStorage.clear();
  animate = vi.spyOn(Element.prototype, "animate");
});

afterEach(() => {
  // Browsers mark an animation's finished promise as handled when it is canceled, as the rail's
  // fold is on unmount; happy-dom rejects it unhandled.
  for (const result of animate.mock.results) {
    if (result.type === "return") {
      result.value.finished.catch(() => undefined);
    }
  }
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const backend = (id: string, available: boolean) => ({
  id,
  name: id,
  kind: "durable-object",
  createdAt: "2026-11-01T00:00:00Z",
  available,
  usage: null,
});

const showShell = (path: string, api: Record<string, Handler> = {}) =>
  renderPage(
    <DashboardShell>
      <p>Page content</p>
    </DashboardShell>,
    { path, api: { "GET /api/backends": () => json([backend("a", true)]), ...api } },
  );

/** The window as a phone: AppShell trades the side navigation for a bar below 768 px. */
const asPhone = (isPhone: () => boolean) => {
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      return query.includes("width <") && query.includes("768") && isPhone();
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return () => {
    for (const listener of listeners) {
      listener();
    }
  };
};

const NAV = ["Overview", "Files", "Credentials", "Storage & Mounts", "Settings"];

describe("DashboardShell", () => {
  it("shows the page beside the navigation", async () => {
    await showShell("/");
    expect(screen.getByText("Page content")).toBeTruthy();
    expect(screen.getByText("Davloom")).toBeTruthy();
    for (const label of NAV) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    expect(screen.getByText("Sign out")).toBeTruthy();
  });

  it.each([
    ["/", "Overview"],
    ["/files", "Files"],
    ["/files/photos", "Files"],
    ["/credentials", "Credentials"],
    ["/storage", "Storage & Mounts"],
    ["/settings", "Settings"],
    ["/filesystem", undefined],
  ])("marks the page at %s as %s", async (path, current) => {
    await showShell(path);
    const marked = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map((link) => link.textContent);
    expect(marked).toEqual(current === undefined ? [] : [current]);
  });

  it.each([
    [[backend("a", true)], undefined],
    [[backend("a", false), backend("b", true)], "1 backend unavailable"],
    [[backend("a", false), backend("b", false)], "2 backends unavailable"],
  ])("names unavailable backends on Storage & Mounts (%#)", async (backends, alert) => {
    await showShell("/", { "GET /api/backends": () => json(backends) });
    const name = alert === undefined ? "Storage & Mounts" : `Storage & Mounts ${alert}`;
    expect(await screen.findByRole("link", { name })).toBeTruthy();
  });

  it("names the alert in the label of the folded rail", async () => {
    await showShell("/", { "GET /api/backends": () => json([backend("a", false)]) });
    await screen.findByRole("link", { name: "Storage & Mounts 1 backend unavailable" });
    await userEvent.click(screen.getByRole("button", { name: /collapse/i }));
    expect(
      await screen.findByRole("link", { name: "Storage & Mounts, 1 backend unavailable" }),
    ).toBeTruthy();
  });

  it.each([
    ["the server ends the session", () => json({ ok: true })],
    ["the session had already ended", () => json({ error: { code: "unauthorized" } }, 401)],
  ])("signs out and opens sign-in when %s", async (_, answer) => {
    const { router, calls, client } = await showShell("/files", {
      "POST /api/auth/sign-out": answer,
    });
    const clear = vi.spyOn(client, "clear");
    await userEvent.click(screen.getByText("Sign out"));
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(calls.some((call) => call.url.endsWith("/api/auth/sign-out"))).toBe(true);
    expect(clear).toHaveBeenCalledOnce();
  });

  it("stays signed in when the sign-out is cancelled", async () => {
    const { router, calls } = await showShell("/files");
    await userEvent.click(screen.getByText("Sign out"));
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(router.state.location.pathname).toBe("/files");
    expect(calls.some((call) => call.url.endsWith("/api/auth/sign-out"))).toBe(false);
  });

  describe("on a phone", () => {
    it("drops the rows down from Menu, and a row closes it", async () => {
      asPhone(() => true);
      const { router } = await showShell("/");
      await userEvent.click(await screen.findByRole("button", { name: "Menu" }));
      const menu = await screen.findByRole("dialog");
      for (const label of NAV) {
        expect(within(menu).getByRole("link", { name: label })).toBeTruthy();
      }
      await userEvent.click(within(menu).getByRole("link", { name: "Files" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/files"));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("signs out from the dropdown", async () => {
      asPhone(() => true);
      const { router } = await showShell("/", {
        "POST /api/auth/sign-out": () => json({ ok: true }),
      });
      await userEvent.click(await screen.findByRole("button", { name: "Menu" }));
      const menu = await screen.findByRole("dialog");
      await userEvent.click(within(menu).getByText("Sign out"));
      const confirm = await screen.findByRole("alertdialog");
      await userEvent.click(within(confirm).getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    });

    it("shuts the dropdown when the window widens past a phone's", async () => {
      let isPhone = true;
      const resize = asPhone(() => isPhone);
      await showShell("/");
      await userEvent.click(await screen.findByRole("button", { name: "Menu" }));
      await screen.findByRole("dialog");
      isPhone = false;
      act(resize);
      await waitFor(() => expect(screen.queryByRole("button", { name: "Menu" })).toBeNull());
      isPhone = true;
      act(resize);
      expect(await screen.findByRole("button", { name: "Menu" })).toBeTruthy();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});

describe("DashboardShell in Chinese", () => {
  it("names the navigation and its rows in Chinese", async () => {
    const { container } = await renderPage(
      <DashboardShell>
        <p>页面内容</p>
      </DashboardShell>,
      {
        path: "/",
        locale: "zh-CN",
        api: { "GET /api/backends": () => json([backend("a", true), backend("b", false)]) },
      },
    );
    expect(await screen.findByRole("link", { name: /^存储与挂载/ })).toBeTruthy();
    for (const label of ["概览", "文件", "凭据", "设置"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    expect(await screen.findByRole("link", { name: /个后端不可用/ })).toBeTruthy();
    expectChinese(container);
  });
});

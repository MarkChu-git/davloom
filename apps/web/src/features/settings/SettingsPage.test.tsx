import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderPage } from "../../test/render";
import { SettingsPage } from "./SettingsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ME = { id: "u", name: "Admin", email: "admin@davloom.test" };

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

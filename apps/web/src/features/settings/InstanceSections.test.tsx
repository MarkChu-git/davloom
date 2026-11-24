import { LayerProvider } from "@astryxdesign/core/Layer";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption, handleCanceledAnimations } from "../../test/layout";
import { json, renderPage, type Handler } from "../../test/render";
import type { InstanceInfo } from "../api/queries";
import { SettingsPage } from "./SettingsPage";

// Settings: the default backend for new mounts, and About this instance.

handleCanceledAnimations();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const backend = (id: string, name: string) => ({
  id,
  name,
  kind: "durable-object",
  createdAt: "2026-11-01T00:00:00Z",
  available: true,
  usage: null,
});

const show = (section: "storage" | "about", api: Record<string, Handler>) =>
  renderPage(
    <LayerProvider>
      <SettingsPage section={section} />
    </LayerProvider>,
    { path: `/settings?section=${section}`, api },
  );

/** The text of a detail's row: its label and its value. */
const value = (label: string) =>
  screen.getByText(label, { exact: true }).closest("[class]")?.parentElement?.textContent;

describe("Settings, Storage", () => {
  it("saves the default backend for new mounts", async () => {
    let saved = "a";
    const { calls } = await show("storage", {
      "GET /api/backends": () => json([backend("a", "Primary"), backend("b", "Archive")]),
      "GET /api/settings/storage": () => json({ defaultBackendId: saved }),
      "PUT /api/settings/storage": async (request) => {
        const body: unknown = await request.json();
        saved = String(Reflect.get(Object(body), "defaultBackendId"));
        return json({ defaultBackendId: saved });
      },
    });
    const save = await screen.findByRole("button", { name: "Save storage settings" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Default backend for new mounts" })).toBeTruthy(),
    );
    expect(save.getAttribute("aria-disabled")).toBe("true");
    await chooseOption("Default backend for new mounts", /^Archive/);
    await userEvent.click(screen.getByRole("button", { name: "Save storage settings" }));
    expect(await screen.findAllByText("Storage settings saved.")).not.toHaveLength(0);
    const put = calls.find((call) => call.method === "PUT");
    expect(await put?.json()).toEqual({ defaultBackendId: "b" });
  });

  it("says why the settings could not be saved", async () => {
    await show("storage", {
      "GET /api/backends": () => json([backend("a", "Primary"), backend("b", "Archive")]),
      "GET /api/settings/storage": () => json({ defaultBackendId: "a" }),
      "PUT /api/settings/storage": () => json({ error: { code: "invalid_input" } }, 400),
    });
    await screen.findByRole("button", { name: "Save storage settings" });
    await chooseOption("Default backend for new mounts", /^Archive/);
    await userEvent.click(screen.getByRole("button", { name: "Save storage settings" }));
    expect(await screen.findAllByText("Check the values and try again.")).not.toHaveLength(0);
  });

  it("says why the settings could not be read", async () => {
    await show("storage", {
      "GET /api/settings/storage": () => json({ error: { code: "x" } }, 500),
    });
    expect(await screen.findByText("Cannot read the storage settings")).toBeTruthy();
  });
});

const INFO: InstanceInfo = {
  version: "0.0.0",
  commit: "8277928f0123456789abcdef",
  runtime: "Cloudflare Workers",
  deployment: "Cloudflare",
  region: "NRT",
  database: "Cloudflare D1",
  storageKinds: ["durable-object", "s3"],
};

describe("Settings, About this instance", () => {
  it("names the version, commit, runtime, deployment, region and database", async () => {
    await show("about", {
      "GET /api/instance": () => json(INFO),
      "GET /api/backends": () => json([]),
      "GET /api/mounts": () => json([]),
    });
    await waitFor(() => expect(value("Runtime")).toContain("Cloudflare Workers"));
    expect(value("Version")).toContain("0.0.0");
    expect(value("Commit")).toContain("8277928f0123");
    expect(value("Commit")).not.toContain("456789abcdef");
    expect(value("Deployment")).toContain("Cloudflare");
    expect(value("Region")).toContain("NRT");
    expect(value("Database")).toContain("Cloudflare D1");
  });

  it("says Unknown for what the instance does not know or cannot tell", async () => {
    await show("about", {
      "GET /api/instance": () => json({ ...INFO, commit: null, region: null }),
    });
    await waitFor(() => expect(value("Commit")).toContain("Unknown"));
    expect(value("Region")).toContain("Unknown");
    cleanup();
    await show("about", { "GET /api/instance": () => json({ error: { code: "x" } }, 500) });
    await waitFor(() => expect(value("Version")).toContain("Unknown"));
  });
});

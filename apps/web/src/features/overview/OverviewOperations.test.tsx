import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCanceledAnimations } from "../../test/layout";
import { json, renderPage, type Handler } from "../../test/render";
import type { Backend, BackendCheck, OperationError, Operations, Overview } from "../api/queries";
import { setErrorView } from "./errorView";
import { OverviewPage } from "./OverviewPage";

// The Overview's operations, recent errors and connection checks.

handleCanceledAnimations();

afterEach(() => {
  cleanup();
  act(() => setErrorView("list"));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const backend = (fields: Partial<Backend> & Pick<Backend, "id" | "name">): Backend => ({
  kind: "durable-object",
  createdAt: "2026-03-01T12:00:00Z",
  available: true,
  usage: { files: 0, collections: 0, bytes: 0 },
  status: { state: "answered", ms: 5 },
  capacity: null,
  config: {},
  hasSecretKey: false,
  ...fields,
});

const OVERVIEW: Overview = {
  usage: { files: 0, collections: 0, bytes: 0 },
  backends: [backend({ id: "b1", name: "Primary" }), backend({ id: "b2", name: "Archive" })],
  mounts: [],
};

const hourStart = (hoursAgo: number) => {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const hours = (counts: Record<number, [number, number]> = {}) =>
  Array.from({ length: 24 }, (_, index) => {
    const ago = 23 - index;
    const [operations, failed] = counts[ago] ?? [0, 0];
    return { start: hourStart(ago), operations, failed };
  });

const ERRORS: OperationError[] = [
  {
    id: "e1",
    at: minutesAgo(12),
    method: "PUT",
    path: "/files/report.pdf",
    destination: null,
    status: 507,
  },
  {
    id: "e2",
    at: minutesAgo(95),
    method: "MOVE",
    path: "/files/Drafts/",
    destination: "/files/Old/",
    status: 412,
  },
];

const show = (operations: Operations, extra: Record<string, Handler> = {}) =>
  renderPage(<OverviewPage />, {
    api: {
      "GET /api/overview": () => json(OVERVIEW),
      "GET /api/operations": () => json(operations),
      "GET /api/settings/storage": () => json({ defaultBackendId: "b2" }),
      ...extra,
    },
  });

describe("OverviewPage, operations", () => {
  it("shows the day's operations, how many failed, and draws them by hour", async () => {
    await show({ hours: hours({ 0: [7, 1], 3: [12, 0], 5: [3, 2] }), errors: ERRORS });
    const chart = await screen.findByRole("img", { name: "Operations per hour, last 24 hours" });
    expect(screen.getByText("22")).toBeTruthy();
    expect(screen.getByText("3 failed")).toBeTruthy();
    expect(chart.querySelector("desc")?.textContent).toBe(
      "22 operations, 3 of them failed, 5 hours ago and now. The busiest hour was 3 hours ago, with 12.",
    );
  });

  it("shows a quiet day without a failed count", async () => {
    await show({ hours: hours(), errors: [] });
    const chart = await screen.findByRole("img", { name: "Operations per hour, last 24 hours" });
    expect(chart.querySelector("desc")?.textContent).toBe("No operations in the last 24 hours.");
    expect(screen.queryByText(/failed$/)).toBeNull();
    expect(
      (await screen.findAllByText("No failed operations in the last 24 hours")).length,
    ).toBeGreaterThan(0);
  });

  it("says why the operations could not be read", async () => {
    await show(
      { hours: [], errors: [] },
      {
        "GET /api/operations": () => json({ error: { code: "boom" } }, 500),
      },
    );
    expect(await screen.findByText("Cannot read the operations")).toBeTruthy();
  });
});

describe("OverviewPage, recent operation errors", () => {
  it("lists each error with its cause, and opens its details", async () => {
    await show({ hours: hours({ 0: [5, 2] }), errors: ERRORS });
    const toggle = await screen.findByRole("button", { name: "Details for report.pdf" });
    expect(screen.getByLabelText("Storage full")).toBeTruthy();
    expect(screen.getByLabelText("Already exists")).toBeTruthy();
    await userEvent.click(toggle);
    expect(await screen.findByText("The backend has no room left.")).toBeTruthy();
    expect(screen.getByText("507")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Details for Drafts" }));
    expect(await screen.findByText("/files/Drafts/ → /files/Old/")).toBeTruthy();
  });

  it("shows errors as a timeline or as tiles", async () => {
    await show({ hours: hours({ 0: [5, 2] }), errors: ERRORS });
    await screen.findByRole("button", { name: "Details for report.pdf" });
    const views = screen.getByRole("radiogroup", { name: "Show errors as" });
    await userEvent.click(within(views).getByRole("radio", { name: "Timeline" }));
    const timeline = await screen.findByRole("img", { name: "Operation errors, last 24 hours" });
    expect(timeline.querySelector("desc")?.textContent).toBe(
      "2 operations failed in the last 24 hours. Drafts: already exists, 2 hours ago. report.pdf: storage full, 12 minutes ago.",
    );
    await userEvent.click(within(views).getByRole("radio", { name: "Tiles" }));
    const tile = await screen.findByRole("button", {
      name: "report.pdf, Storage full, 12 minutes ago",
    });
    await userEvent.click(tile);
    expect(await screen.findByText("The backend has no room left.")).toBeTruthy();
  });
});

describe("OverviewPage, connections", () => {
  it("marks the default backend", async () => {
    await show({ hours: hours(), errors: [] });
    await waitFor(() =>
      expect(screen.getByText("Default · Cloudflare Durable Objects")).toBeTruthy(),
    );
  });

  it.each([
    {
      title: "every backend answers",
      results: [
        { id: "b1", name: "Primary", available: true, latencyMs: 4, reason: null },
        { id: "b2", name: "Archive", available: true, latencyMs: 9, reason: null },
      ],
      message: "Checked 2 backends. Every one answered.",
    },
    {
      title: "one does not",
      results: [
        { id: "b1", name: "Primary", available: true, latencyMs: 4, reason: null },
        {
          id: "b2",
          name: "Archive",
          available: false,
          latencyMs: null,
          reason: "The bucket does not exist",
        },
      ],
      message: "Checked 2 backends. Archive: The bucket does not exist.",
    },
  ])("checks the connections when $title", async ({ results, message }) => {
    const checks: BackendCheck[] = results.map((result) => ({
      ...result,
      checkedAt: new Date().toISOString(),
    }));
    const { calls } = await show(
      { hours: hours(), errors: [] },
      { "POST /api/backends/check": () => json(checks) },
    );
    await screen.findByText("Default · Cloudflare Durable Objects");
    await userEvent.click(screen.getByRole("button", { name: "Check connections" }));
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/check"))).toBe(true);
  });

  it("says when the check itself fails", async () => {
    await show(
      { hours: hours(), errors: [] },
      { "POST /api/backends/check": () => json({ error: { code: "x" } }, 500) },
    );
    await screen.findByText("Default · Cloudflare Durable Objects");
    await userEvent.click(screen.getByRole("button", { name: "Check connections" }));
    expect(
      (await screen.findAllByText("The server refused the request (500).")).length,
    ).toBeGreaterThan(0);
  });
});

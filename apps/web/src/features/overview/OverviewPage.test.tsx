import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCanceledAnimations } from "../../test/layout";
import { expectChinese } from "../../test/chinese";
import { json, renderPage } from "../../test/render";
import type { Backend, Mount, Overview } from "../api/queries";
import { OverviewPage } from "./OverviewPage";

handleCanceledAnimations();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const backend = (fields: Partial<Backend> & Pick<Backend, "id" | "name">): Backend => ({
  kind: "durable-object",
  createdAt: "2026-03-01T12:00:00Z",
  available: true,
  usage: { files: 1, collections: 0, bytes: 100 },
  status: { state: "answered", ms: 5 },
  capacity: null,
  config: {},
  hasSecretKey: false,
  ...fields,
});
const mount = (fields: Pick<Mount, "id" | "name" | "backendId" | "root">): Mount => ({
  backendKind: "durable-object",
  createdAt: "2026-03-03T12:00:00Z",
  ...fields,
});

const PRIMARY = backend({
  id: "b1",
  name: "Primary",
  usage: { files: 12, collections: 3, bytes: 2_500_000 },
});
const ARCHIVE = backend({
  id: "b2",
  name: "Archive",
  kind: "s3-ish",
  available: false,
  usage: null,
});
const SPARE = backend({
  id: "b3",
  name: "Spare",
  usage: { files: 4, collections: 1, bytes: 9000 },
});
const FILES = mount({ id: "files", name: "files", backendId: "b1", root: "" });
const PHOTOS = mount({ id: "photos", name: "photos", backendId: "b1", root: "pics" });
const LOST = mount({ id: "lost", name: "lost", backendId: "gone", root: "" });

const OVERVIEW: Overview = {
  usage: { files: 12, collections: 3, bytes: 2_500_000 },
  backends: [PRIMARY, ARCHIVE, SPARE],
  mounts: [FILES, PHOTOS, LOST],
};

const show = (overview: Overview) =>
  renderPage(<OverviewPage />, { api: { "GET /api/overview": () => json(overview) } });

/** The text of the tile whose label is `label`: the nearest element around it that holds more. */
const tileOf = (label: string): string => {
  // The Mounts panel has a heading of the same words.
  let element: HTMLElement | null =
    screen.getAllByText(label, { exact: true }).find((text) => !/^H\d$/.test(text.tagName)) ?? null;
  while (element !== null && element.textContent === label) {
    element = element.parentElement;
  }
  return element?.textContent ?? "";
};

/** The list item, in the panel titled `panel`, whose label is `label`. */
const itemOf = (panel: string, label: string): HTMLElement => {
  let element: HTMLElement | null = screen.getByRole("heading", { level: 2, name: panel });
  while (element !== null && within(element).queryAllByRole("listitem").length === 0) {
    element = element.parentElement;
  }
  const item = within(element ?? document.body)
    .getAllByRole("listitem")
    .find((candidate) => within(candidate).queryByText(label, { exact: true }) !== null);
  if (item === undefined) {
    throw new Error(`No item ${label} in ${panel}`);
  }
  return item;
};

describe("OverviewPage, tiles", () => {
  it.each([
    {
      title: "several backends, one unavailable",
      overview: {
        ...OVERVIEW,
        mounts: [FILES, PHOTOS, mount({ id: "spare", name: "spare", backendId: "b3", root: "" })],
      },
      tiles: {
        Stored: ["2.5 MB", "12 files in 3 folders"],
        Mounts: ["3", "On 2 of 3 backends"],
        "Known capacity": ["No fixed limit", "2.5 MB stored"],
      },
    },
    {
      title: "one backend with one of each",
      overview: {
        usage: { files: 1, collections: 1, bytes: 120 },
        backends: [backend({ id: "b1", name: "Only", capacity: 400 })],
        mounts: [mount({ id: "m", name: "m", backendId: "b1", root: "" })],
      },
      tiles: {
        Stored: ["120 bytes", "1 file in 1 folder"],
        Mounts: ["1", "On 1 of 1 backend"],
        "Known capacity": ["25%", "100 bytes of 400 bytes"],
      },
    },
    {
      title: "two backends that both answer",
      overview: {
        usage: { files: 0, collections: 0, bytes: 0 },
        backends: [
          backend({ id: "b1", name: "One", capacity: 1000 }),
          backend({ id: "b2", name: "Two", capacity: 1000, usage: null }),
          backend({ id: "b3", name: "Three", capacity: null }),
        ],
        mounts: [],
      },
      tiles: {
        Stored: ["0 bytes", "0 files in 0 folders"],
        Mounts: ["0", "On 0 of 3 backends"],
        "Known capacity": ["5%", "100 bytes of 2 kB"],
      },
    },
  ])("reads the figures of $title", async ({ overview, tiles }) => {
    await show(overview);
    await screen.findByRole("img", { name: "Bytes stored on each backend" });
    for (const [label, texts] of Object.entries(tiles)) {
      const tile = tileOf(label);
      for (const text of texts) {
        expect(tile).toContain(text);
      }
    }
  });

  it("shows placeholders while the overview loads", async () => {
    const { container } = await renderPage(<OverviewPage />, {
      api: { "GET /api/overview": () => new Promise<Response>(() => undefined) },
    });
    // The tiles come once the header is on screen, with placeholders for their figures.
    expect((await screen.findAllByText("Stored", { exact: true })).length).toBeGreaterThan(0);
    for (const label of ["Mounts", "Known capacity"]) {
      expect((await screen.findAllByText(label, { exact: true })).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole("img", { name: "Bytes stored on each backend" })).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(container.textContent).not.toContain("No mounts yet");
  });
});

describe("OverviewPage, panels", () => {
  it("draws the bytes on each backend, largest first", async () => {
    await show(OVERVIEW);
    const chart = await screen.findByRole("img", { name: "Bytes stored on each backend" });
    expect(chart.querySelector("desc")?.textContent).toBe(
      "Primary stores 2.5 MB, Spare stores 9 kB, and Archive stores 0 bytes.",
    );
    expect(screen.getByRole("link", { name: "Manage storage" }).getAttribute("href")).toBe(
      "/storage",
    );
  });

  it.each([
    {
      name: "Primary",
      description: "Cloudflare Durable Objects · /files · /photos",
      status: "Available",
    },
    { name: "Archive", description: "s3-ish", status: "Unavailable" },
    { name: "Spare", description: "Cloudflare Durable Objects", status: "Available" },
  ])("lists the connection to $name", async ({ name, description, status }) => {
    await show(OVERVIEW);
    await screen.findByRole("img", { name: "Bytes stored on each backend" });
    const item = itemOf("Connections", name);
    expect(within(item).getByText(description)).toBeTruthy();
    expect(within(item).getByText(status)).toBeTruthy();
  });

  it.each([
    { path: "/files", description: "Primary · whole backend", href: "/files?path=%2Ffiles" },
    { path: "/photos", description: "Primary · /pics", href: "/files?path=%2Fphotos" },
    { path: "/lost", description: "Unknown backend · whole backend", href: "/files?path=%2Flost" },
  ])("lists $path with a link to its files", async ({ path, description, href }) => {
    await show(OVERVIEW);
    const link = await screen.findByRole("link", { name: new RegExp(`^${path}`) });
    expect(link.getAttribute("href")).toBe(href);
    expect(within(itemOf("Mounts", path)).getByText(description)).toBeTruthy();
  });

  it("says when there are no mounts yet, and links to Files", async () => {
    await show({ ...OVERVIEW, mounts: [] });
    expect(await screen.findByText("No mounts yet. Add one on Storage & Mounts.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Files" }).getAttribute("href")).toBe("/files");
  });

  it("offers the WebDAV address to copy", async () => {
    await show(OVERVIEW);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "WebDAV address" }).value).toBe(
      `${location.origin}/dav/`,
    );
    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();
  });
});

describe("OverviewPage, errors", () => {
  it("says why the overview could not be read, and reads it again", async () => {
    let refuse = true;
    await renderPage(<OverviewPage />, {
      api: {
        "GET /api/overview": () =>
          refuse ? json({ error: { code: "boom" } }, 500) : json(OVERVIEW),
      },
    });
    expect(await screen.findByText("Cannot read the overview")).toBeTruthy();
    expect(screen.getByText("The server refused the request (500).")).toBeTruthy();
    expect(screen.queryByText("Stored", { exact: true })).toBeNull();
    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("img", { name: "Bytes stored on each backend" })).toBeTruthy();
    expect(tileOf("Stored")).toContain("2.5 MB");
    expect(screen.queryByText("Cannot read the overview")).toBeNull();
  });
});

describe("OverviewPage in Chinese", () => {
  it("writes its tiles, panels and figures in Chinese", async () => {
    const { container } = await renderPage(<OverviewPage />, {
      locale: "zh-CN",
      api: { "GET /api/overview": () => json(OVERVIEW) },
    });
    expect(await screen.findByText("12 个文件，分布在 3 个文件夹中")).toBeTruthy();
    expect(screen.getByText("已存储")).toBeTruthy();
    // The panels render after the tiles, one by one: wait for the last of them, for the chart's
    // code and for the failed read of the operations, so the check sees the whole page every time.
    expect(await screen.findByText("最近的操作错误")).toBeTruthy();
    expect(await screen.findByRole("img", { name: "各后端存储的字节数" })).toBeTruthy();
    expect(await screen.findByText("无法读取操作记录")).toBeTruthy();
    expectChinese(container, [
      "Primary",
      "Archive",
      // The Archive backend's kind, one the page does not know and so shows as it is.
      "s3-ish",
      "Spare",
      "files",
      "photos",
      "pics",
      "lost",
      "MB",
      "kB",
    ]);
  });
});

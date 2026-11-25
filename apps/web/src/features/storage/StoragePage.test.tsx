import { LayerProvider } from "@astryxdesign/core/Layer";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseFromMenu,
  chooseOption,
  fill,
  handleCanceledAnimations,
  layOutAt,
  NARROW,
  WIDE,
} from "../../test/layout";
import { expectChinese } from "../../test/chinese";
import { json, renderPage, type Handler } from "../../test/render";
import type { Backend, Mount } from "../api/queries";
import { StoragePage } from "./StoragePage";

handleCanceledAnimations();

// A LayerProvider of its own gives each render its own toasts, which the fallback viewport would
// otherwise keep from one test to the next.
const Page = () => (
  <LayerProvider>
    <StoragePage />
  </LayerProvider>
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PRIMARY: Backend = {
  id: "b1",
  name: "Primary",
  kind: "durable-object",
  createdAt: "2026-03-01T12:00:00Z",
  available: true,
  usage: { files: 3, collections: 2, bytes: 1500 },
};
const ARCHIVE: Backend = {
  id: "b2",
  name: "Archive",
  kind: "s3-ish",
  createdAt: "2026-03-02T12:00:00Z",
  available: false,
  usage: null,
};
const mount = (fields: Pick<Mount, "id" | "name" | "backendId" | "root">): Mount => ({
  backendKind: "durable-object",
  createdAt: "2026-03-03T12:00:00Z",
  ...fields,
});
const FILES = mount({ id: "files", name: "files", backendId: "b1", root: "" });
const PHOTOS = mount({ id: "photos", name: "photos", backendId: "b1", root: "pics/2024" });
const LOST = mount({ id: "lost", name: "lost", backendId: "gone", root: "" });

const storageApi = (
  backends: Backend[],
  mounts: Mount[],
  more: Record<string, Handler> = {},
): Record<string, Handler> => ({
  "GET /api/backends": () => json(backends),
  "GET /api/mounts": () => json(mounts),
  ...more,
});

const withMethod = (calls: Request[], method: string) =>
  calls.filter((call) => call.method === method);

/** The card of a backend: the nearest element around its heading that holds its details. */
const cardOf = (name: string): HTMLElement => {
  let element: HTMLElement | null = screen.getByRole("heading", { level: 3, name });
  while (element !== null && !(element.textContent ?? "").includes("Mounts")) {
    element = element.parentElement;
  }
  if (element === null) {
    throw new Error(`No card for ${name}`);
  }
  return element;
};

const rowOf = (path: string): HTMLElement => {
  const row = screen
    .getAllByRole("row")
    .find((candidate) => within(candidate).queryByText(path, { exact: true }) !== null);
  if (row === undefined) {
    throw new Error(`No row for ${path}`);
  }
  return row;
};

/** Whether a button is turned off: Astryx keeps it focusable and marks it aria-disabled. */
const isOff = (name: string): boolean =>
  screen.getByRole("button", { name }).getAttribute("aria-disabled") === "true";

const dialog = () => screen.findByRole("dialog");

const field = (name: RegExp) => within(screen.getByRole("dialog")).getByRole("textbox", { name });
const NAME = /^Folder name/;
const ROOT = /^Folder in the backend/;

const submit = (label: string) =>
  userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: label }));

describe("StoragePage, backends", () => {
  it.each([
    { width: WIDE, layout: "wide" },
    { width: NARROW, layout: "narrow" },
  ])("shows each backend's card, $layout", async ({ width }) => {
    layOutAt(width);
    await renderPage(<Page />, { api: storageApi([PRIMARY, ARCHIVE], [FILES, PHOTOS]) });
    await screen.findByRole("heading", { level: 3, name: "Primary" });
    const primary = cardOf("Primary").textContent;
    for (const text of [
      "Cloudflare Durable Objects",
      "Available",
      "EndpointBuilt in",
      "Objects5",
      "Stored1.5 kB, no fixed limit",
      "Mounts2",
    ]) {
      expect(primary).toContain(text);
    }
    const archive = cardOf("Archive").textContent;
    for (const text of ["s3-ish", "Unavailable", "StoredUnknown", "ObjectsUnknown", "Mounts0"]) {
      expect(archive).toContain(text);
    }
  });

  it("says why the backends could not be read, and leaves both add buttons off", async () => {
    await renderPage(<Page />, {
      api: {
        "GET /api/backends": () => json({ error: { code: "boom" } }, 500),
        "GET /api/mounts": () => json([]),
      },
    });
    expect(await screen.findByText("Cannot read the backends")).toBeTruthy();
    expect(screen.getByText("The server refused the request (500).")).toBeTruthy();
    expect(isOff("Add backend")).toBe(true);
    expect(isOff("Add mount")).toBe(true);
  });

  it.each([
    { name: "", problem: "Enter a name for the backend." },
    { name: "x".repeat(65), problem: "Use at most 64 characters." },
    { name: " Primary ", problem: "Another backend already has this name." },
  ])("keeps the backend form open for the name '$name'", async ({ name, problem }) => {
    const { calls } = await renderPage(<Page />, { api: storageApi([PRIMARY], []) });
    await userEvent.click(await screen.findByRole("button", { name: "Add backend" }));
    await dialog();
    if (name !== "") {
      await fill(field(/^Name/), name);
    }
    await submit("Add backend");
    expect(await within(screen.getByRole("dialog")).findByText(problem)).toBeTruthy();
    expect(withMethod(calls, "POST")).toHaveLength(0);
    await fill(field(/^Name/), "z");
    expect(within(screen.getByRole("dialog")).queryByText(problem)).toBeNull();
  });

  it("adds a Durable Objects backend", async () => {
    let backends = [PRIMARY];
    const { calls } = await renderPage(<Page />, {
      api: {
        "GET /api/backends": () => json(backends),
        "GET /api/mounts": () => json([]),
        "POST /api/backends": () => {
          backends = [PRIMARY, { ...ARCHIVE, id: "b3", name: "Cold", available: true }];
          return json({ id: "b3" });
        },
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Add backend" }));
    expect(within(await dialog()).getAllByText("Cloudflare Durable Objects")).not.toHaveLength(0);
    await fill(field(/^Name/), " Cold {Enter}");
    expect(await screen.findAllByText("Added backend “Cold”.")).not.toHaveLength(0);
    expect(await screen.findByRole("heading", { level: 3, name: "Cold" })).toBeTruthy();
    expect(await withMethod(calls, "POST")[0]?.json()).toEqual({
      name: "Cold",
      kind: "durable-object",
    });
  });

  it.each([
    { status: 409, code: "name_taken", problem: "Another backend already has this name." },
    { status: 500, code: "boom", problem: "The server refused the request (500)." },
    { status: 401, code: "unauthorized", problem: "Your session has ended. Sign in again." },
  ])("says why the server refused the backend ($code)", async ({ status, code, problem }) => {
    await renderPage(<Page />, {
      api: storageApi([PRIMARY], [], {
        "POST /api/backends": () => json({ error: { code } }, status),
      }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Add backend" }));
    await dialog();
    await fill(field(/^Name/), "Cold");
    await submit("Add backend");
    expect(await within(screen.getByRole("dialog")).findByText(problem)).toBeTruthy();
  });

  it("closes the backend form with Cancel", async () => {
    await renderPage(<Page />, { api: storageApi([PRIMARY], []) });
    await userEvent.click(await screen.findByRole("button", { name: "Add backend" }));
    await dialog();
    await submit("Cancel");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("StoragePage, mounts", () => {
  it("lists each mount with its backend and folder", async () => {
    layOutAt(WIDE);
    await renderPage(<Page />, { api: storageApi([PRIMARY, ARCHIVE], [FILES, PHOTOS, LOST]) });
    await screen.findByText("/files");
    expect(within(rowOf("/files")).getByText("Primary")).toBeTruthy();
    expect(within(rowOf("/files")).getByText("Whole backend")).toBeTruthy();
    expect(within(rowOf("/photos")).getByText("/pics/2024")).toBeTruthy();
    expect(within(rowOf("/lost")).getByText("Unknown backend")).toBeTruthy();
  });

  it("says when there are no mounts yet", async () => {
    await renderPage(<Page />, { api: storageApi([PRIMARY], []) });
    expect(await screen.findByText("No mounts yet")).toBeTruthy();
  });

  it("says why the mounts could not be read", async () => {
    await renderPage(<Page />, {
      api: {
        "GET /api/backends": () => json([PRIMARY]),
        "GET /api/mounts": () => json({ error: { code: "unauthorized" } }, 401),
      },
    });
    expect(await screen.findByText("Cannot read the mounts")).toBeTruthy();
  });

  it("leaves Add mount off while there is no backend", async () => {
    await renderPage(<Page />, { api: storageApi([], []) });
    await screen.findByText("No mounts yet");
    await waitFor(() => expect(isOff("Add backend")).toBe(false));
    expect(isOff("Add mount")).toBe(true);
  });

  it.each([
    { name: "", root: "", problem: "Enter a folder name." },
    { name: "a/b", root: "", problem: "Use one folder name, without slashes." },
    { name: "..", root: "", problem: "Choose another folder name." },
    { name: "/files/", root: "", problem: "Another mount already uses this folder." },
    {
      name: "music",
      root: "a/../b",
      problem: "Name a folder of the backend, without . or .. in its path.",
    },
  ])("keeps the mount form open for $name in '$root'", async ({ name, root, problem }) => {
    const { calls } = await renderPage(<Page />, { api: storageApi([PRIMARY], [FILES]) });
    await screen.findByText("/files");
    await userEvent.click(screen.getByRole("button", { name: "Add mount" }));
    await dialog();
    if (name !== "") {
      await fill(field(NAME), name);
    }
    if (root !== "") {
      await fill(field(ROOT), root);
    }
    await submit("Add mount");
    expect(await within(screen.getByRole("dialog")).findByText(problem)).toBeTruthy();
    expect(withMethod(calls, "POST")).toHaveLength(0);
  });

  it("clears a problem once its field changes", async () => {
    await renderPage(<Page />, { api: storageApi([PRIMARY], []) });
    await userEvent.click(await screen.findByRole("button", { name: "Add mount" }));
    await dialog();
    await fill(field(ROOT), "..");
    await submit("Add mount");
    const inDialog = within(screen.getByRole("dialog"));
    expect(await inDialog.findByText("Enter a folder name.")).toBeTruthy();
    expect(inDialog.getByText(/without \. or \.\. in its path/)).toBeTruthy();
    await fill(field(ROOT), "x");
    expect(inDialog.queryByText(/without \. or \.\. in its path/)).toBeNull();
    await fill(field(NAME), "x");
    expect(inDialog.queryByText("Enter a folder name.")).toBeNull();
  });

  it("adds a mount of a backend's folder", async () => {
    layOutAt(WIDE);
    let mounts: Mount[] = [];
    const { calls } = await renderPage(<Page />, {
      api: {
        "GET /api/backends": () => json([PRIMARY, ARCHIVE]),
        "GET /api/mounts": () => json(mounts),
        "POST /api/mounts": () => {
          mounts = [mount({ id: "music", name: "music", backendId: "b2", root: "x/y" })];
          return json({ id: "music" });
        },
      },
    });
    await screen.findByText("No mounts yet");
    await userEvent.click(screen.getByRole("button", { name: "Add mount" }));
    await dialog();
    await fill(field(NAME), " /music/ ");
    await chooseOption("Backend", /^Archive/);
    await fill(field(ROOT), "/x//y/{Enter}");
    expect(await screen.findAllByText("Added /music.")).not.toHaveLength(0);
    expect(await withMethod(calls, "POST")[0]?.json()).toEqual({
      name: "music",
      backendId: "b2",
      root: "x/y",
    });
    expect(await screen.findByText("/x/y")).toBeTruthy();
  });

  it.each([
    {
      status: 409,
      code: "name_taken",
      root: "",
      problem: "Another mount already uses this folder.",
    },
    {
      status: 400,
      code: "invalid_input",
      root: "nowhere",
      problem: "No folder of this name is in the backend.",
    },
    {
      status: 400,
      code: "invalid_input",
      root: "",
      problem: "The server refused the mount. Check the folder name and the folder.",
    },
    {
      status: 0,
      code: "network",
      root: "",
      problem: "Davloom could not be reached. Check the connection and try again.",
    },
  ])(
    "says why the server refused a new mount ($code, root '$root')",
    async ({ status, code, root, problem }) => {
      await renderPage(<Page />, {
        api: storageApi([PRIMARY], [], {
          "POST /api/mounts": () => {
            if (status === 0) {
              throw new TypeError("offline");
            }
            return json({ error: { code } }, status);
          },
        }),
      });
      await userEvent.click(await screen.findByRole("button", { name: "Add mount" }));
      await dialog();
      await fill(field(NAME), "music");
      if (root !== "") {
        await fill(field(ROOT), root);
      }
      await submit("Add mount");
      expect(await within(screen.getByRole("dialog")).findByText(problem)).toBeTruthy();
    },
  );

  it("closes the mount form with Cancel", async () => {
    await renderPage(<Page />, { api: storageApi([PRIMARY], []) });
    await userEvent.click(await screen.findByRole("button", { name: "Add mount" }));
    await dialog();
    await submit("Cancel");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("StoragePage, renaming", () => {
  it("shows the mount's backend and folder, and renames it", async () => {
    layOutAt(WIDE);
    let mounts = [FILES, PHOTOS];
    const { calls } = await renderPage(<Page />, {
      api: {
        "GET /api/backends": () => json([PRIMARY]),
        "GET /api/mounts": () => json(mounts),
        "PATCH /api/mounts/photos": () => {
          mounts = [FILES, { ...PHOTOS, name: "images" }];
          return json({ id: "photos" });
        },
      },
    });
    await chooseFromMenu("Actions for mount /photos", "Rename");
    const form = within(await dialog());
    expect(form.getByRole("heading", { name: "Rename /photos" })).toBeTruthy();
    expect(form.getByText("Primary")).toBeTruthy();
    expect(form.getByText("/pics/2024")).toBeTruthy();
    expect(form.queryByRole("combobox", { name: "Backend" })).toBeNull();
    await userEvent.clear(field(NAME));
    await fill(field(NAME), "images");
    await submit("Rename");
    expect(await screen.findAllByText("Renamed to /images.")).not.toHaveLength(0);
    expect(await withMethod(calls, "PATCH")[0]?.json()).toEqual({ name: "images" });
    expect(await screen.findByText("/images")).toBeTruthy();
  });

  it("closes without a request when the name stays the same", async () => {
    layOutAt(WIDE);
    const { calls } = await renderPage(<Page />, { api: storageApi([PRIMARY], [FILES]) });
    await chooseFromMenu("Actions for mount /files", "Rename");
    await dialog();
    expect(within(screen.getByRole("dialog")).getByText("Whole backend")).toBeTruthy();
    await fill(field(NAME), "/");
    await submit("Rename");
    expect(await screen.findAllByText("Renamed to /files.")).not.toHaveLength(0);
    expect(withMethod(calls, "PATCH")).toHaveLength(0);
  });

  it.each([
    { name: "photos", problem: "Another mount already uses this folder.", code: undefined },
    { name: "docs", problem: "Another mount already uses this folder.", code: "name_taken" },
    { name: "docs", problem: "It is no longer there.", code: "not_found" },
  ])("keeps the rename open for $name ($code)", async ({ name, problem, code }) => {
    layOutAt(WIDE);
    await renderPage(<Page />, {
      api: storageApi([PRIMARY], [FILES, PHOTOS, LOST], {
        "PATCH /api/mounts/lost": () => json({ error: { code } }, code === "not_found" ? 404 : 409),
      }),
    });
    await chooseFromMenu("Actions for mount /lost", "Rename");
    await dialog();
    expect(within(screen.getByRole("dialog")).getByText("Unknown")).toBeTruthy();
    await userEvent.clear(field(NAME));
    await fill(field(NAME), name);
    await submit("Rename");
    expect(await within(screen.getByRole("dialog")).findByText(problem)).toBeTruthy();
  });
});

describe("StoragePage, moving", () => {
  it("points a mount at a folder of another backend", async () => {
    layOutAt(WIDE);
    let mounts = [FILES];
    const { calls } = await renderPage(<Page />, {
      api: {
        "GET /api/backends": () => json([PRIMARY, ARCHIVE]),
        "GET /api/mounts": () => json(mounts),
        "PATCH /api/mounts/files": () => {
          mounts = [{ ...FILES, backendId: "b2", root: "moved" }];
          return json({ id: "files" });
        },
      },
    });
    await chooseFromMenu("Actions for mount /files", "Move to another backend");
    const form = within(await dialog());
    expect(form.getByRole("heading", { name: "Move /files" })).toBeTruthy();
    expect(form.getByText(/bun run migrate/)).toBeTruthy();
    await fill(field(ROOT), "/moved/{Enter}");
    expect(await screen.findAllByText("/files now shows Archive.")).not.toHaveLength(0);
    expect(await withMethod(calls, "PATCH")[0]?.json()).toEqual({ backendId: "b2", root: "moved" });
    expect(await screen.findByText("/moved")).toBeTruthy();
  });

  it("asks for another backend first when there is none", async () => {
    layOutAt(WIDE);
    const { calls } = await renderPage(<Page />, { api: storageApi([PRIMARY], [FILES]) });
    await chooseFromMenu("Actions for mount /files", "Move to another backend");
    const form = within(await dialog());
    expect(form.getByText("Add another backend first, then copy the files to it.")).toBeTruthy();
    await submit("Move mount");
    expect(withMethod(calls, "PATCH")).toHaveLength(0);
  });

  it.each([
    {
      root: "../up",
      code: undefined,
      problem: "Name a folder of the backend, without . or .. in its path.",
    },
    {
      root: "nowhere",
      code: "invalid_input",
      problem: "No folder of this name is in the backend.",
    },
    { root: "", code: "not_found", problem: "It is no longer there." },
  ])("keeps the move open for '$root' ($code)", async ({ root, code, problem }) => {
    layOutAt(WIDE);
    const { calls } = await renderPage(<Page />, {
      api: storageApi([PRIMARY, ARCHIVE], [FILES], {
        "PATCH /api/mounts/files": () =>
          json({ error: { code } }, code === "not_found" ? 404 : 400),
      }),
    });
    await chooseFromMenu("Actions for mount /files", "Move to another backend");
    await dialog();
    if (root !== "") {
      await fill(field(ROOT), root);
    }
    await submit("Move mount");
    expect(await within(screen.getByRole("dialog")).findByText(problem)).toBeTruthy();
    expect(withMethod(calls, "PATCH")).toHaveLength(code === undefined ? 0 : 1);
    await fill(field(ROOT), "x");
    expect(within(screen.getByRole("dialog")).queryByText(problem)).toBeNull();
  });
});

describe("StoragePage, removing", () => {
  it.each([
    { path: "/files", next: "/photos" },
    { path: "/photos", next: "/files" },
  ])("removes $path after a confirmation", async ({ path }) => {
    layOutAt(WIDE);
    let mounts = [FILES, PHOTOS];
    const id = path.slice(1);
    const { calls } = await renderPage(<Page />, {
      api: {
        "GET /api/backends": () => json([PRIMARY]),
        "GET /api/mounts": () => json(mounts),
        [`DELETE /api/mounts/${id}`]: () => {
          mounts = mounts.filter((item) => item.id !== id);
          return json({ id });
        },
      },
    });
    await chooseFromMenu(`Actions for mount ${path}`, "Remove");
    const confirmation = within(await screen.findByRole("alertdialog"));
    expect(confirmation.getByText(`Remove ${path}?`)).toBeTruthy();
    await userEvent.click(confirmation.getByRole("button", { name: "Remove mount" }));
    expect(await screen.findAllByText(`Removed ${path}.`)).not.toHaveLength(0);
    await waitFor(() => expect(screen.queryByText(path, { exact: true })).toBeNull());
    expect(withMethod(calls, "DELETE")).toHaveLength(1);
  });

  it("removes the last mount", async () => {
    layOutAt(WIDE);
    let mounts = [FILES];
    await renderPage(<Page />, {
      api: {
        "GET /api/backends": () => json([PRIMARY]),
        "GET /api/mounts": () => json(mounts),
        "DELETE /api/mounts/files": () => {
          mounts = [];
          return json({ id: "files" });
        },
      },
    });
    await chooseFromMenu("Actions for mount /files", "Remove");
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove mount" }),
    );
    expect(await screen.findByText("No mounts yet")).toBeTruthy();
  });

  it("says why a mount could not be removed", async () => {
    layOutAt(WIDE);
    await renderPage(<Page />, {
      api: storageApi([PRIMARY], [FILES], {
        "DELETE /api/mounts/files": () => json({ error: { code: "mount_in_use" } }, 409),
      }),
    });
    await chooseFromMenu("Actions for mount /files", "Remove");
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove mount" }),
    );
    expect(
      await screen.findAllByText("An API key is limited to this mount. Revoke that key first."),
    ).not.toHaveLength(0);
  });
});

const openDetails = async (path: string) => {
  await userEvent.click(await screen.findByRole("button", { name: `Details for mount ${path}` }));
  return within(await screen.findByRole("group", { name: `Details for mount ${path}` }));
};

describe("StoragePage, narrow", () => {
  it("lists each mount as a row that opens to show its folder", async () => {
    layOutAt(NARROW);
    await renderPage(<Page />, { api: storageApi([PRIMARY], [FILES, PHOTOS, LOST]) });
    expect(screen.queryByRole("table")).toBeNull();
    expect((await openDetails("/photos")).getByText("/pics/2024")).toBeTruthy();
    expect((await openDetails("/files")).getByText("Whole backend")).toBeTruthy();
    expect(screen.getByText("Unknown backend")).toBeTruthy();
  });

  it.each([
    { button: "Rename", heading: "Rename /files" },
    { button: "Move", heading: "Move /files" },
  ])("opens $button from a mount's details", async ({ button, heading }) => {
    layOutAt(NARROW);
    await renderPage(<Page />, { api: storageApi([PRIMARY, ARCHIVE], [FILES]) });
    await userEvent.click((await openDetails("/files")).getByRole("button", { name: button }));
    expect(within(await dialog()).getByRole("heading", { name: heading })).toBeTruthy();
    await submit("Cancel");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("removes a mount from its details", async () => {
    layOutAt(NARROW);
    let mounts = [FILES, PHOTOS];
    await renderPage(<Page />, {
      api: {
        "GET /api/backends": () => json([PRIMARY]),
        "GET /api/mounts": () => json(mounts),
        "DELETE /api/mounts/files": () => {
          mounts = [PHOTOS];
          return json({ id: "files" });
        },
      },
    });
    await userEvent.click((await openDetails("/files")).getByRole("button", { name: "Remove" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove mount" }),
    );
    expect(await screen.findAllByText("Removed /files.")).not.toHaveLength(0);
    await waitFor(() => expect(screen.queryByText("/files", { exact: true })).toBeNull());
  });
});

describe("StoragePage in Chinese", () => {
  it("writes its backends, mounts and states in Chinese", async () => {
    const { container } = await renderPage(<Page />, {
      locale: "zh-CN",
      api: storageApi([PRIMARY, ARCHIVE], [FILES, PHOTOS, LOST]),
    });
    await screen.findAllByText("Primary");
    expect(screen.getAllByText("不可用").length).toBeGreaterThan(0);
    expectChinese(container, [
      "Primary",
      "Archive",
      "s3-ish",
      "/files",
      "/photos",
      "/lost",
      "pics/2024",
      "kB",
    ]);
  });
});

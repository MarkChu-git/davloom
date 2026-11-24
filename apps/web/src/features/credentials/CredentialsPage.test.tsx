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
import { json, renderPage, type Handler } from "../../test/render";
import type { ApiKey, Mount } from "../api/queries";
import { CredentialsPage } from "./CredentialsPage";

handleCanceledAnimations();

// A LayerProvider of its own gives each render its own toasts, which the fallback viewport would
// otherwise keep from one test to the next.
const Page = () => (
  <LayerProvider>
    <CredentialsPage />
  </LayerProvider>
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const key = (fields: Partial<ApiKey> & Pick<ApiKey, "id" | "name">): ApiKey => ({
  start: "dvk_ab",
  access: "read-write",
  paths: null,
  enabled: true,
  expiresAt: null,
  createdAt: "2026-03-15T12:00:00Z",
  lastUsedAt: null,
  ...fields,
});

const READER = key({
  id: "k1",
  name: "Reader",
  access: "read-only",
  paths: ["/files/photos", "/files/albums"],
  expiresAt: "2099-06-01T12:00:00Z",
  createdAt: "2026-03-10T12:00:00Z",
});
// Used a minute ago: "Last used" reads relative to the time the page renders.
const WRITER = key({
  id: "k2",
  name: "Writer",
  createdAt: "2026-03-20T12:00:00Z",
  lastUsedAt: new Date(Date.now() - 61_000).toISOString(),
});
const OLD = key({
  id: "k3",
  name: "Old",
  start: null,
  paths: [],
  expiresAt: "2020-01-01T12:00:00Z",
  createdAt: "2026-01-01T12:00:00Z",
});
const OFF = key({ id: "k4", name: "Paused", enabled: false, createdAt: "2026-02-01T12:00:00Z" });
const KEYS = [READER, WRITER, OLD, OFF];

const mount = (name: string): Mount => ({
  id: `m-${name}`,
  name,
  backendId: "b1",
  backendKind: "durable-object",
  root: "",
  createdAt: "2026-01-01T00:00:00Z",
});
const MOUNTS = [mount("files"), mount("photos")];

const keysApi = (rows: ApiKey[], more: Record<string, Handler> = {}) => ({
  "GET /api/keys": () => json(rows),
  "GET /api/mounts": () => json(MOUNTS),
  ...more,
});

const rowOf = (name: string): HTMLElement => {
  const row = screen
    .getAllByRole("row")
    .find((candidate) => within(candidate).queryByText(name, { exact: true }) !== null);
  if (row === undefined) {
    throw new Error(`No row for ${name}`);
  }
  return row;
};

const cellsOf = (name: string): string[] =>
  within(rowOf(name))
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");

const openForm = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "Create key" }));
  return screen.findByRole("dialog");
};

describe("CredentialsPage, wide", () => {
  it.each([
    {
      name: "Writer",
      cells: [
        "Writer",
        "dvk_ab…",
        "Read and write",
        "All mounts",
        "1 minute ago",
        "Never",
        "Active",
      ],
    },
    {
      name: "Reader",
      cells: [
        "Reader",
        "dvk_ab…",
        "Read only",
        "/files/photos, /files/albums",
        "Never",
        "Jun 1, 2099",
        "Active",
      ],
    },
    {
      name: "Old",
      cells: [
        "Old",
        "—",
        "Read and write",
        "Nothing: its folders cannot be read",
        "Jan 1, 2020",
        "Expired",
      ],
    },
    { name: "Paused", cells: ["Paused", "Read and write", "Never", "Off"] },
  ])("shows $name with its details", async ({ name, cells }) => {
    layOutAt(WIDE);
    await renderPage(<Page />, { api: keysApi(KEYS) });
    await screen.findByText(name);
    const text = cellsOf(name).join(" | ");
    for (const cell of cells) {
      expect(text).toContain(cell);
    }
  });

  it("lists the newest key first", async () => {
    layOutAt(WIDE);
    await renderPage(<Page />, { api: keysApi(KEYS) });
    await screen.findByText("Writer");
    const names = ["Writer", "Reader", "Paused", "Old"];
    const rows = screen.getAllByRole("row");
    const order = names.map((name) => rows.indexOf(rowOf(name)));
    expect(order).toEqual(order.toSorted((a, b) => a - b));
  });

  it("revokes a key from its menu after a confirmation", async () => {
    layOutAt(WIDE);
    let rows = [...KEYS];
    const { calls } = await renderPage(<Page />, {
      api: keysApi([], {
        "GET /api/keys": () => json(rows),
        "DELETE /api/keys/k2": () => {
          rows = rows.filter((row) => row.id !== "k2");
          return json({ id: "k2" });
        },
      }),
    });
    await chooseFromMenu("Actions for key Writer", "Revoke");
    const confirmation = await screen.findByRole("alertdialog");
    expect(within(confirmation).getByText("Revoke “Writer”?")).toBeTruthy();
    expect(
      within(confirmation).getByText(
        "Clients signed in with it lose access, and this cannot be undone.",
      ),
    ).toBeTruthy();
    await userEvent.click(within(confirmation).getByRole("button", { name: "Revoke" }));
    expect(await screen.findAllByText("Revoked “Writer”.")).not.toHaveLength(0);
    await waitFor(() => expect(screen.queryByText("Writer", { exact: true })).toBeNull());
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });

  it("says why a revoke failed", async () => {
    layOutAt(WIDE);
    await renderPage(<Page />, {
      api: keysApi([WRITER], {
        "DELETE /api/keys/k2": () => json({ error: { code: "not_found" } }, 404),
      }),
    });
    await chooseFromMenu("Actions for key Writer", "Revoke");
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke" }),
    );
    expect(await screen.findAllByText("It is no longer there.")).not.toHaveLength(0);
  });

  it("revokes the last key and leaves the empty list", async () => {
    layOutAt(WIDE);
    let rows = [WRITER];
    await renderPage(<Page />, {
      api: {
        "GET /api/keys": () => json(rows),
        "DELETE /api/keys/k2": () => {
          rows = [];
          return json({ id: "k2" });
        },
      },
    });
    await chooseFromMenu("Actions for key Writer", "Revoke");
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke" }),
    );
    expect(await screen.findByText("No keys yet")).toBeTruthy();
  });
});

describe("CredentialsPage, narrow", () => {
  it.each([
    {
      name: "Writer",
      facts: [
        "Read and write",
        "All mounts",
        "Last used",
        "1 minute ago",
        "Mar 20, 2026",
        "Expires",
        "Never",
      ],
    },
    {
      name: "Reader",
      facts: ["Read only", "/files/photos, /files/albums", "Last used", "Never", "Jun 1, 2099"],
    },
    { name: "Old", facts: ["Nothing: its folders cannot be read", "Expired", "Jan 1, 2020"] },
  ])("opens $name to show its details", async ({ name, facts }) => {
    layOutAt(NARROW);
    await renderPage(<Page />, { api: keysApi(KEYS) });
    await userEvent.click(await screen.findByRole("button", { name: `Details for key ${name}` }));
    const details = await screen.findByRole("group", { name: `Details for key ${name}` });
    for (const fact of facts) {
      expect(within(details).getAllByText(fact).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole("table")).toBeNull();
  });

  it.each([
    { name: "Writer", status: "Active" },
    { name: "Old", status: "Expired" },
    { name: "Paused", status: "Off" },
  ])("shows the status of $name in its row", async ({ name, status }) => {
    layOutAt(NARROW);
    await renderPage(<Page />, {
      api: keysApi([key({ ...KEYS.find((k) => k.name === name), id: "x", name })]),
    });
    await screen.findByText(name);
    expect(screen.getAllByText(status).length).toBeGreaterThan(0);
  });

  it("revokes a key from its details", async () => {
    layOutAt(NARROW);
    let rows = [READER, WRITER];
    await renderPage(<Page />, {
      api: {
        "GET /api/keys": () => json(rows),
        "DELETE /api/keys/k1": () => {
          rows = [WRITER];
          return json({ id: "k1" });
        },
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Details for key Reader" }));
    const details = await screen.findByRole("group", { name: "Details for key Reader" });
    await userEvent.click(within(details).getByRole("button", { name: "Revoke" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke" }),
    );
    expect(await screen.findAllByText("Revoked “Reader”.")).not.toHaveLength(0);
    await waitFor(() => expect(screen.queryByText("Reader", { exact: true })).toBeNull());
  });
});

describe("CredentialsPage, states", () => {
  it("offers a first key when there is none", async () => {
    await renderPage(<Page />, { api: keysApi([]) });
    expect(await screen.findByText("No keys yet")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Create a key" }));
    expect(await screen.findByRole("heading", { name: "Create a key" })).toBeTruthy();
  });

  it("says why the keys could not be read, and reads them again", async () => {
    let fail = true;
    await renderPage(<Page />, {
      api: {
        "GET /api/keys": () =>
          fail ? json({ error: { code: "unauthorized" } }, 401) : json([WRITER]),
      },
    });
    expect(await screen.findByText("Cannot read the keys")).toBeTruthy();
    expect(screen.getByText("Your session has ended. Sign in again.")).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Writer")).toBeTruthy();
  });
});

describe("CredentialsPage, create", () => {
  const FOLDER = /^Folder inside the mount/;
  const DOTS = "Name a folder inside the mount, without . or .. in its path.";

  it.each([
    { name: "", folder: "", problem: "Name the key after the device or person that will use it." },
    {
      name: "   ",
      folder: "",
      problem: "Name the key after the device or person that will use it.",
    },
    { name: "x".repeat(65), folder: "", problem: "Use at most 64 characters." },
    { name: "Phone", folder: "photos/../x", problem: DOTS },
    { name: "Phone", folder: "./x", problem: DOTS },
  ])("keeps the form open for name $name and folder $folder", async ({ name, folder, problem }) => {
    const { calls } = await renderPage(<Page />, { api: keysApi([]) });
    const dialog = await openForm();
    expect(within(dialog).queryByText(problem)).toBeNull();
    if (name !== "") {
      await fill(within(dialog).getByRole("textbox", { name: /^Name/ }), name);
    }
    if (folder !== "") {
      await chooseOption("Mount", "/files");
      await fill(within(dialog).getByRole("textbox", { name: FOLDER }), folder);
    }
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }));
    expect(await within(dialog).findByText(problem)).toBeTruthy();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("clears the name's problem once the name changes", async () => {
    await renderPage(<Page />, { api: keysApi([]) });
    const dialog = await openForm();
    const problem = "Name the key after the device or person that will use it.";
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }));
    expect(await within(dialog).findByText(problem)).toBeTruthy();
    await fill(within(dialog).getByRole("textbox", { name: /^Name/ }), "A");
    expect(within(dialog).queryByText(problem)).toBeNull();
  });

  it.each([
    {
      title: "with the defaults",
      readOnly: false,
      expiry: undefined,
      mount: undefined,
      folder: "",
      body: { name: "Phone", access: "read-write", expiresInDays: 90 },
    },
    {
      title: "read only, limited to a folder, never expiring",
      readOnly: true,
      expiry: "Never",
      mount: "/files",
      folder: " /photos//2026/ ",
      body: {
        name: "Phone",
        access: "read-only",
        expiresInDays: null,
        paths: ["/files/photos/2026"],
      },
    },
    {
      title: "limited to a whole mount",
      readOnly: false,
      expiry: undefined,
      mount: "/photos",
      folder: "",
      body: { name: "Phone", access: "read-write", expiresInDays: 90, paths: ["/photos"] },
    },
    {
      title: "for all mounts, though a folder was typed first",
      readOnly: false,
      expiry: undefined,
      mount: "All mounts",
      folder: "photos",
      body: { name: "Phone", access: "read-write", expiresInDays: 90 },
    },
    {
      title: "expiring in a year",
      readOnly: false,
      expiry: "In a year",
      mount: undefined,
      folder: "",
      body: { name: "Phone", access: "read-write", expiresInDays: 365 },
    },
  ])(
    "creates a key $title and shows it once",
    async ({ readOnly, expiry, mount: choice, folder, body }) => {
      let rows: ApiKey[] = [];
      const { calls } = await renderPage(<Page />, {
        api: {
          "GET /api/keys": () => json(rows),
          "GET /api/mounts": () => json(MOUNTS),
          "POST /api/keys": () => {
            rows = [key({ id: "new", name: "Phone" })];
            return json({ id: "new", key: "dvk_secret_value" });
          },
        },
      });
      const dialog = await openForm();
      await fill(within(dialog).getByRole("textbox", { name: /^Name/ }), "  Phone ");
      if (readOnly) {
        await userEvent.click(within(dialog).getByRole("switch", { name: "Read only" }));
      }
      if (expiry !== undefined) {
        await chooseOption("Expires", expiry);
      }
      if (folder !== "") {
        // The folder belongs to a mount, so the field is off until one is chosen.
        expect(
          within(dialog)
            .getByRole("textbox", { name: FOLDER })
            .matches(":disabled, [aria-disabled=true]"),
        ).toBe(true);
        await chooseOption("Mount", "/files");
        await fill(within(dialog).getByRole("textbox", { name: FOLDER }), folder);
      }
      if (choice !== undefined) {
        await chooseOption("Mount", choice);
      }
      await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }));
      expect(await screen.findByRole("heading", { name: "Key “Phone” is ready" })).toBeTruthy();
      expect(screen.getByRole<HTMLInputElement>("textbox", { name: "API key" }).value).toBe(
        "dvk_secret_value",
      );
      expect(screen.getByText(`${location.origin}/dav/`)).toBeTruthy();
      const post = calls.find((call) => call.method === "POST");
      expect(await post?.json()).toEqual(body);
      await userEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(await screen.findAllByText("Created key “Phone”.")).not.toHaveLength(0);
      await waitFor(() =>
        expect(screen.queryByRole("heading", { name: "Key “Phone” is ready" })).toBeNull(),
      );
    },
  );

  it("creates a key with Enter in the name field", async () => {
    const { calls } = await renderPage(<Page />, {
      api: keysApi([], { "POST /api/keys": () => json({ id: "new", key: "dvk_x" }) }),
    });
    const dialog = await openForm();
    await fill(within(dialog).getByRole("textbox", { name: /^Name/ }), "Tablet{Enter}");
    expect(await screen.findByRole("heading", { name: "Key “Tablet” is ready" })).toBeTruthy();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("creates a key with Enter in the folder field", async () => {
    const { calls } = await renderPage(<Page />, {
      api: keysApi([], { "POST /api/keys": () => json({ id: "new", key: "dvk_x" }) }),
    });
    const dialog = await openForm();
    await fill(within(dialog).getByRole("textbox", { name: /^Name/ }), "Tablet");
    await chooseOption("Mount", "/files");
    await fill(within(dialog).getByRole("textbox", { name: FOLDER }), "inbox{Enter}");
    expect(await screen.findByRole("heading", { name: "Key “Tablet” is ready" })).toBeTruthy();
    const post = calls.find((call) => call.method === "POST");
    expect(await post?.json()).toMatchObject({ paths: ["/files/inbox"] });
  });

  it("offers every mount, and clears the folder's problem when the mount changes", async () => {
    await renderPage(<Page />, { api: keysApi([]) });
    const dialog = await openForm();
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Mount" }));
    for (const option of ["All mounts", "/files", "/photos"]) {
      expect(await screen.findByRole("option", { name: option, hidden: true })).toBeTruthy();
    }
    await userEvent.keyboard("{Escape}");
    await fill(within(dialog).getByRole("textbox", { name: /^Name/ }), "Phone");
    await chooseOption("Mount", "/files");
    await fill(within(dialog).getByRole("textbox", { name: FOLDER }), "..");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }));
    expect(await within(dialog).findByText(DOTS)).toBeTruthy();
    await chooseOption("Mount", "/photos");
    expect(within(dialog).queryByText(DOTS)).toBeNull();
  });

  it.each([
    { status: 409, code: "name_taken", message: "That name is already in use." },
    { status: 400, code: "invalid_input", message: "Check the values and try again." },
    { status: 500, code: "boom", message: "The server refused the request (500)." },
  ])("says why the server refused the key ($code)", async ({ status, code, message }) => {
    await renderPage(<Page />, {
      api: keysApi([], { "POST /api/keys": () => json({ error: { code } }, status) }),
    });
    const dialog = await openForm();
    await fill(within(dialog).getByRole("textbox", { name: /^Name/ }), "Phone");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }));
    expect(await within(dialog).findByText(message)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Key “Phone” is ready" })).toBeNull();
  });

  it("closes the form with Cancel without creating a key", async () => {
    const { calls } = await renderPage(<Page />, { api: keysApi([]) });
    const dialog = await openForm();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(screen.queryByText(/^Created key/)).toBeNull();
  });

  it("closes the form with Escape", async () => {
    await renderPage(<Page />, { api: keysApi([]) });
    await openForm();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the new key on screen through Escape, until Done", async () => {
    await renderPage(<Page />, {
      api: keysApi([], { "POST /api/keys": () => json({ id: "new", key: "dvk_x" }) }),
    });
    const dialog = await openForm();
    await fill(within(dialog).getByRole("textbox", { name: /^Name/ }), "Tablet{Enter}");
    const heading = await screen.findByRole("heading", { name: "Key “Tablet” is ready" });
    // The key must be read before the dialog goes, so it asks for a choice, as an alert does.
    const shown = screen.getByRole("alertdialog");
    await userEvent.keyboard("{Escape}");
    expect(heading.isConnected).toBe(true);
    expect(shown.isConnected).toBe(true);
    expect(screen.queryAllByText("Created key “Tablet”.")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(await screen.findAllByText("Created key “Tablet”.")).not.toHaveLength(0);
  });
});

const renameApi = (onPatch: (body: unknown) => Response) => {
  let rows = [WRITER];
  return keysApi([], {
    "GET /api/keys": () => json(rows),
    "PATCH /api/keys/k2": async (request) => {
      const body: unknown = await request.json();
      const answer = onPatch(body);
      if (answer.ok) {
        rows = [{ ...WRITER, name: "Work phone" }];
      }
      return answer;
    },
  });
};

describe("CredentialsPage, rename", () => {
  it.each([
    { width: WIDE, open: () => chooseFromMenu("Actions for key Writer", "Rename") },
    {
      width: NARROW,
      open: async () => {
        await userEvent.click(
          await screen.findByRole("button", { name: "Details for key Writer" }),
        );
        const details = await screen.findByRole("group", { name: "Details for key Writer" });
        await userEvent.click(within(details).getByRole("button", { name: "Rename" }));
      },
    },
  ])("renames a key at $width px", async ({ width, open }) => {
    layOutAt(width);
    const bodies: unknown[] = [];
    await renderPage(<Page />, {
      api: renameApi((body) => {
        bodies.push(body);
        return json({ id: "k2", name: "Work phone" });
      }),
    });
    await screen.findByText("Writer");
    await open();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Rename “Writer”")).toBeTruthy();
    const field = within(dialog).getByRole<HTMLInputElement>("textbox", { name: /^Name/ });
    expect(field.value).toBe("Writer");
    await userEvent.clear(field);
    await fill(field, "  Work phone {Enter}");
    expect(await screen.findAllByText("Renamed to “Work phone”.")).not.toHaveLength(0);
    expect(bodies).toEqual([{ name: "Work phone" }]);
    expect(await screen.findByText("Work phone")).toBeTruthy();
  });

  it.each([
    { name: "", problem: "Name the key after the device or person that will use it." },
    { name: "x".repeat(65), problem: "Use at most 64 characters." },
  ])("keeps the dialog open for the name $name", async ({ name, problem }) => {
    layOutAt(WIDE);
    const bodies: unknown[] = [];
    await renderPage(<Page />, {
      api: renameApi((body) => {
        bodies.push(body);
        return json({});
      }),
    });
    await chooseFromMenu("Actions for key Writer", "Rename");
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByRole("textbox", { name: /^Name/ });
    await userEvent.clear(field);
    if (name !== "") {
      await fill(field, name);
    }
    await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    expect(await within(dialog).findByText(problem)).toBeTruthy();
    expect(bodies).toEqual([]);
  });

  it("sends nothing for the same name, and says why the server refused", async () => {
    layOutAt(WIDE);
    let calls = 0;
    await renderPage(<Page />, {
      api: renameApi(() => {
        calls += 1;
        return json({ error: { code: "not_found" } }, 404);
      }),
    });
    await chooseFromMenu("Actions for key Writer", "Rename");
    let dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls).toBe(0);
    await chooseFromMenu("Actions for key Writer", "Rename");
    dialog = await screen.findByRole("dialog");
    await fill(within(dialog).getByRole("textbox", { name: /^Name/ }), "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    expect(await within(dialog).findByText("It is no longer there.")).toBeTruthy();
    expect(calls).toBe(1);
  });
});

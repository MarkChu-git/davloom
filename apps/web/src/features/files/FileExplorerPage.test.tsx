import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Backend, Mount } from "../api/queries";
import { FakeDav } from "../../test/fakeDav";
import { json, renderPage, type Handler } from "../../test/render";
import { FileExplorerPage } from "./FileExplorerPage";
import { clearFinished } from "./uploadStore";

afterEach(() => {
  cleanup();
  clearFinished();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MOUNTS: Mount[] = [
  {
    id: "m1",
    name: "files",
    backendId: "b1",
    backendKind: "durable-object",
    root: "",
    createdAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "m2",
    name: "photos",
    backendId: "b2",
    backendKind: "durable-object",
    root: "photos",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const BACKENDS: Backend[] = [
  {
    id: "b1",
    name: "Main storage",
    kind: "durable-object",
    createdAt: "2026-01-01T00:00:00.000Z",
    available: true,
    usage: null,
  },
  {
    id: "b2",
    name: "Photo storage",
    kind: "durable-object",
    createdAt: "2026-01-01T00:00:00.000Z",
    available: true,
    usage: null,
  },
];

const WIDE = 1400;
const NARROW = 360;

/** Lays the page out as if every box were `width` pixels wide. */
const layOut = (width: number) => {
  vi.stubGlobal("innerWidth", width);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, width, 600),
  );
};

const README = "Read me first.\n";

/** A folder with a subfolder and files of three sizes, as the browser tests seed it. */
const seeded = () =>
  new FakeDav()
    .folder("/files")
    .folder("/photos")
    .folder("/files/Drafts")
    .folder("/files/Archive")
    .file("/files/Drafts/blog-post.md", { body: "# Draft\n", contentType: "text/markdown" })
    .file("/files/README.txt", {
      body: README,
      contentType: "text/plain; charset=utf-8",
      modifiedAt: "2026-03-01T10:00:00.000Z",
    })
    .file("/files/Quarterly report.pdf", {
      body: "%PDF",
      contentType: "application/pdf",
      sizeBytes: 120_000,
      modifiedAt: "2026-02-01T10:00:00.000Z",
    })
    .file("/files/budget.xlsx", { body: "x".repeat(120), modifiedAt: "2026-01-01T10:00:00.000Z" });

const open = async (
  path: string,
  {
    dav = seeded(),
    selectedName,
    width = WIDE,
    api = {},
  }: { dav?: FakeDav; selectedName?: string; width?: number; api?: Record<string, Handler> } = {},
) => {
  layOut(width);
  const search = new URLSearchParams();
  if (path !== "/") {
    search.set("path", path);
  }
  if (selectedName !== undefined) {
    search.set("file", selectedName);
  }
  const rendered = await renderPage(<FileExplorerPage path={path} selectedName={selectedName} />, {
    path: `/files?${search.toString()}`,
    api: dav.api({
      "GET /api/mounts": () => json(MOUNTS),
      "GET /api/backends": () => json(BACKENDS),
      ...api,
    }),
  });
  return { ...rendered, dav };
};

/** The names of the rows that can be selected, in the order the listing shows them. */
const listed = () =>
  screen
    .getAllByRole("checkbox")
    .map((box) => (box instanceof HTMLInputElement ? (box.labels?.[0]?.textContent ?? "") : ""))
    .filter((label) => label.startsWith("Select ") && label !== "Select all rows")
    .map((label) => label.slice("Select ".length));

/** The files among them, which follow the folders. */
const filesListed = () => listed().filter((name) => name.includes("."));

/** The link in the listing named exactly `name`. */
const link = (name: string) => screen.findByRole("link", { name });

const dialog = () => screen.findByRole("dialog");

const search = () => screen.getByRole("searchbox", { name: "Search this folder" });

/** The value the details give for `label`, such as "Size". */
const detail = (label: string) =>
  screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;

const chooseAction = async (row: string, action: string) => {
  const name = `Actions for ${row}`;
  await userEvent.click(await screen.findByRole("button", { name }));
  const menu = await screen.findByRole("menu", { name });
  // A menu's popover never opens in happy-dom, so user-event takes its items for unclickable.
  fireEvent.click(within(menu).getByRole("menuitem", { name: action }));
};

/** Text the page shows or announces, which a toast can do twice: on screen and to a live region. */
const said = async (text: string) => (await screen.findAllByText(text, {}, { timeout: 5000 }))[0];

describe("the top level", () => {
  it.each([
    [WIDE, ["Name", "Size", "Added"]],
    [NARROW, ["Name, A to Z"]],
  ])("at %i px lists the mounts as folders, with no row to select", async (width, headers) => {
    await open("/", { width });
    expect(await link("files")).toBeTruthy();
    expect((await link("photos")).getAttribute("href")).toBe("/files?path=%2Fphotos");
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(
      headers,
    );
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.getByRole("link", { name: "Manage mounts" }).getAttribute("href")).toBe(
      "/storage",
    );
    expect(screen.queryByRole("button", { name: "New folder" })).toBeNull();
  });

  it("names each mount's backend under it on a narrow listing", async () => {
    await open("/", { width: NARROW });
    expect(await screen.findByText("Main storage")).toBeTruthy();
    expect(screen.getByText("Photo storage")).toBeTruthy();
  });

  it("says when there are no mounts yet", async () => {
    await open("/", { api: { "GET /api/mounts": () => json([]) } });
    expect(await screen.findByRole("heading", { name: "No mounts yet" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Manage mounts" })).toHaveLength(2);
  });

  it("says why the mounts cannot be read, and reads them again on Try again", async () => {
    let isDown = true;
    await open("/", {
      api: {
        "GET /api/mounts": () =>
          isDown ? json({ error: { code: "internal" } }, 500) : json(MOUNTS),
      },
    });
    expect(await said("Cannot list /")).toBeTruthy();
    expect(screen.getByText("Something went wrong. Try again.")).toBeTruthy();
    isDown = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await link("files")).toBeTruthy();
  });
});

describe("a folder", () => {
  it("names the folder in the breadcrumb and lists folders above files", async () => {
    await open("/files/Drafts");
    expect(await link("blog-post.md")).toBeTruthy();
    const crumbs = screen.getByRole("navigation", { name: "Folder" });
    expect(within(crumbs).getByRole("link", { name: "files" }).getAttribute("href")).toBe(
      "/files?path=%2Ffiles",
    );
    expect(within(crumbs).getByText("Drafts")).toBeTruthy();
  });

  it("lists folders first, then files by name", async () => {
    await open("/files");
    await link("README.txt");
    expect(listed()).toEqual([
      "Archive",
      "Drafts",
      "budget.xlsx",
      "Quarterly report.pdf",
      "README.txt",
    ]);
  });

  it.each([
    ["a mount that does not exist", "/nowhere", undefined],
    ["a folder the server does not have", "/files/Gone", undefined],
    ["a folder the server refuses as missing", "/files/Drafts", 404],
  ])("%s says so and offers Go to Files", async (_, path, refusal) => {
    const dav = seeded();
    if (refusal !== undefined) {
      dav.refusals.set(`PROPFIND ${path}`, refusal);
    }
    await open(path, { dav });
    expect(await screen.findByRole("heading", { name: "This folder does not exist" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Files" }).getAttribute("href")).toBe("/files");
    expect(screen.queryByRole("button", { name: "New folder" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
  });

  it("shows no rows while it loads, then the listing", async () => {
    const dav = seeded();
    dav.held.add("PROPFIND /files");
    await open("/files", { dav });
    await waitFor(() => expect(dav.holding()).toBe(1));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("heading", { name: "This folder is empty" })).toBeNull();
    dav.release();
    expect(await link("README.txt")).toBeTruthy();
  });

  it.each([
    [503, "The storage backend is not answering."],
    [401, "Your session has ended. Sign in again."],
    [507, "The storage backend is full."],
    [418, "The server refused the request (418)."],
  ])(
    "a listing refused with %i says why, with no buttons that change content",
    async (code, why) => {
      const dav = seeded();
      dav.refusals.set("PROPFIND /files", code);
      await open("/files", { dav });
      expect(await said("Cannot list /files")).toBeTruthy();
      expect(screen.getAllByText(why).length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: "New folder" })).toBeNull();
      dav.refusals.clear();
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await link("README.txt")).toBeTruthy();
      expect(screen.getByRole("button", { name: "New folder" })).toBeTruthy();
    },
  );

  it("a listing that cannot reach the server tries once more, then says so", async () => {
    const dav = seeded();
    let attempts = 0;
    await open("/files", {
      dav,
      api: {
        "PROPFIND /dav/files/": () => {
          attempts += 1;
          throw new TypeError("offline");
        },
      },
    });
    expect(
      await said("Davloom could not be reached. Check the connection and try again."),
    ).toBeTruthy();
    expect(attempts).toBe(2);
  }, 10_000);

  it("an empty folder says so and offers New folder and Upload", async () => {
    await open("/files/Archive");
    expect(await screen.findByRole("heading", { name: "This folder is empty" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New folder" })).toHaveLength(2);
    const uploads = screen.getAllByRole("button", { name: "Upload" });
    expect(uploads).toHaveLength(2);
    await userEvent.click(uploads[1] ?? uploads[0]!);
    expect(await screen.findByRole("heading", { name: "Upload" })).toBeTruthy();
  });

  it("opens a subfolder from its row's menu", async () => {
    const { router } = await open("/files");
    await chooseAction("Drafts", "Open");
    await waitFor(() => expect(router.state.location.search).toEqual({ path: "/files/Drafts" }));
  });
});

describe("sorting", () => {
  it.each([
    ["Size", ["README.txt", "budget.xlsx", "Quarterly report.pdf"]],
    ["Modified", ["budget.xlsx", "Quarterly report.pdf", "README.txt"]],
  ])("by %s keeps folders first, both ways", async (header, ascending) => {
    await open("/files");
    await link("README.txt");
    await userEvent.click(screen.getByRole("button", { name: header }));
    await waitFor(() => expect(filesListed()).toEqual(ascending));
    expect(listed().slice(0, 2).toSorted()).toEqual(["Archive", "Drafts"]);
    await userEvent.click(screen.getByRole("button", { name: header }));
    await waitFor(() => expect(filesListed()).toEqual(ascending.toReversed()));
    expect(listed().slice(0, 2).toSorted()).toEqual(["Archive", "Drafts"]);
  });

  it("a narrow listing sorts through its menu and shows size and age under each name", async () => {
    await open("/files", { width: NARROW });
    await link("README.txt");
    expect(screen.getByText(/^120 bytes · /)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Name, A to Z" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Size" }));
    await waitFor(() =>
      expect(filesListed()).toEqual(["README.txt", "budget.xlsx", "Quarterly report.pdf"]),
    );
    await userEvent.click(screen.getByRole("button", { name: "Size, smallest first" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Largest first" }));
    await waitFor(() =>
      expect(filesListed()).toEqual(["Quarterly report.pdf", "budget.xlsx", "README.txt"]),
    );
    expect(screen.getByRole("button", { name: "Size, largest first" })).toBeTruthy();
  });
});

describe("searching", () => {
  it("keeps the names that match, whatever their case", async () => {
    await open("/files");
    await link("README.txt");
    await userEvent.type(search(), "REPORT");
    await waitFor(() => expect(listed()).toEqual(["Quarterly report.pdf"]));
  });

  it("says when nothing matches, and Clear search brings the list back", async () => {
    await open("/files");
    await link("README.txt");
    await userEvent.type(search(), "zzz");
    expect(await screen.findByRole("heading", { name: "Nothing here matches “zzz”" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await link("README.txt")).toBeTruthy();
  });
});

describe("details", () => {
  it("sit beside a wide listing with the file's size, type, backend and text", async () => {
    const { router } = await open("/files", { selectedName: "README.txt" });
    expect(await screen.findByText(README.trim())).toBeTruthy();
    expect(screen.getByRole("heading", { name: "README.txt", level: 2 })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "README.txt" })).toBeNull();
    expect(detail("Location")).toBe("/files");
    expect(detail("Size")).toBe("15 bytes");
    expect(detail("Type")).toBe("text/plain");
    expect(detail("Stored on")).toBe("Main storage");
    expect(detail("Modified")).toMatch(/2026/);
    await userEvent.click(screen.getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ path: "/files" }));
  });

  it.each([
    ["budget.xlsx", "XLSX file", "No preview for this kind of file."],
    ["Quarterly report.pdf", "application/pdf", "No preview for this kind of file."],
  ])("of %s give its type as %s and say %s", async (name, type, preview) => {
    await open("/files", { selectedName: name });
    expect(await screen.findByText(preview)).toBeTruthy();
    expect(detail("Type")).toBe(type);
  });

  it.each([
    ["LICENSE", "File", "Unknown"],
    ["notes.md", "MD file", "Unknown"],
  ])("of %s with no type or time say %s and %s", async (name, type, modified) => {
    const dav = seeded().file(`/files/${name}`, { body: "text" });
    await open("/files", { dav, selectedName: name });
    await screen.findByRole("heading", { name, level: 2 });
    expect(detail("Type")).toBe(type);
    expect(detail("Modified")).toBe(modified);
  });

  it("say when the preview cannot be read", async () => {
    const dav = seeded();
    dav.refusals.set("GET /files/README.txt", 503);
    await open("/files", { dav, selectedName: "README.txt" });
    expect(
      await said("The preview could not be read. The storage backend is not answering."),
    ).toBeTruthy();
  });

  it("open in a dialog named after the file on a narrow page, and closing it clears the address", async () => {
    const { router } = await open("/files", { selectedName: "README.txt", width: NARROW });
    const details = await screen.findByRole("dialog", { name: "README.txt" });
    expect(await within(details).findByText(README.trim())).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close details" })).toBeNull();
    await userEvent.click(within(details).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(router.state.location.search).toEqual({ path: "/files" }));
  });

  it("show nothing for a name the folder does not hold", async () => {
    await open("/files", { selectedName: "missing.txt" });
    await link("README.txt");
    expect(screen.queryByRole("button", { name: "Close details" })).toBeNull();
  });
});

/** Types into the open dialog's only field, replacing what it held, and presses `submit`. */
const submitDialog = async (value: string, submit: string) => {
  const form = await dialog();
  const field = within(form).getByRole("textbox");
  await userEvent.clear(field);
  if (value !== "") {
    await userEvent.type(field, value);
  }
  await userEvent.click(within(form).getByRole("button", { name: submit }));
  return form;
};

describe("a new folder", () => {
  it("is made on the server, and the list shows it", async () => {
    const { dav } = await open("/files");
    await link("README.txt");
    await userEvent.click(screen.getByRole("button", { name: "New folder" }));
    expect((await dialog()).textContent).toContain("New folder");
    await submitDialog("Receipts 2026", "Create folder");
    expect(await said("Created “Receipts 2026”.")).toBeTruthy();
    expect(await link("Receipts 2026")).toBeTruthy();
    expect(dav.nodes.get("/files/Receipts 2026")?.kind).toBe("folder");
  });

  it.each([
    ["", "Enter a name."],
    ["Drafts", "Something with this name is already here."],
    ["a/b", "Names cannot contain a slash."],
    ["..", "Choose another name."],
  ])("named %j is refused before any request: %s", async (name, problem) => {
    const { dav, calls } = await open("/files");
    await link("README.txt");
    await userEvent.click(screen.getByRole("button", { name: "New folder" }));
    const form = await submitDialog(name, "Create folder");
    expect(await within(form).findByText(problem)).toBeTruthy();
    expect(calls.some((call) => call.method === "MKCOL")).toBe(false);
    expect(dav.paths()).toEqual(seeded().paths());
    // The reason goes away as soon as the name changes.
    await userEvent.type(within(form).getByRole("textbox"), "x");
    expect(within(form).queryByText(problem)).toBeNull();
  });

  it("says why the server refused it", async () => {
    const dav = seeded();
    dav.refusals.set("MKCOL /files/Full", 507);
    await open("/files", { dav });
    await link("README.txt");
    await userEvent.click(screen.getByRole("button", { name: "New folder" }));
    const form = await submitDialog("Full", "Create folder");
    expect(await within(form).findByText("The storage backend is full.")).toBeTruthy();
  });

  it("is not made when the dialog is cancelled", async () => {
    const { calls } = await open("/files");
    await link("README.txt");
    await userEvent.click(screen.getByRole("button", { name: "New folder" }));
    await userEvent.click(within(await dialog()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((call) => call.method === "MKCOL")).toBe(false);
  });
});

describe("renaming", () => {
  it("moves the file to its new name", async () => {
    const { dav } = await open("/files");
    await chooseAction("README.txt", "Rename");
    await submitDialog("READ ME first.txt", "Rename");
    expect(await said("Renamed to “READ ME first.txt”.")).toBeTruthy();
    expect(await link("READ ME first.txt")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "README.txt" })).toBeNull();
    expect(dav.nodes.get("/files/READ ME first.txt")?.body).toBe(README);
  });

  it("keeps a selected row selected under its new name", async () => {
    await open("/files");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select README.txt" }));
    await chooseAction("README.txt", "Rename");
    await submitDialog("NOTES.txt", "Rename");
    await said("Renamed to “NOTES.txt”.");
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>("checkbox", { name: "Select NOTES.txt" }).checked,
      ).toBe(true),
    );
  });

  it("with the same name closes without a request", async () => {
    const { calls } = await open("/files");
    await chooseAction("README.txt", "Rename");
    await userEvent.click(within(await dialog()).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((call) => call.method === "MOVE")).toBe(false);
  });

  it.each([
    ["Drafts", undefined, "Something with this name is already here."],
    ["  ", undefined, "Enter a name."],
    ["Locked.txt", 423, "Another client has locked it."],
  ])("to %j is refused: %s", async (name, refusal, problem) => {
    const dav = seeded();
    if (refusal !== undefined) {
      dav.refusals.set("MOVE /files/README.txt", refusal);
    }
    await open("/files", { dav });
    await chooseAction("README.txt", "Rename");
    const form = await submitDialog(name, "Rename");
    expect(await within(form).findByText(problem)).toBeTruthy();
    expect(dav.nodes.has("/files/README.txt")).toBe(true);
  });

  it("from the details takes the details to the new name", async () => {
    const { router } = await open("/files", { selectedName: "README.txt" });
    await screen.findByText(README.trim());
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await submitDialog("Guide.txt", "Rename");
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ path: "/files", file: "Guide.txt" }),
    );
  });
});

describe("moving and copying", () => {
  it.each([
    ["Move", "Moved", false],
    ["Copy", "Copied", true],
  ])("%s takes README.txt to Drafts", async (action, past, isKept) => {
    const { dav } = await open("/files");
    await chooseAction("README.txt", action);
    const form = await dialog();
    // The form starts from the folder that is open.
    expect(within(form).getByRole<HTMLInputElement>("textbox").value).toBe("/files");
    await submitDialog("/files/Drafts", action);
    expect(await said(`${past} “README.txt” to /files/Drafts.`)).toBeTruthy();
    expect(dav.nodes.get("/files/Drafts/README.txt")?.body).toBe(README);
    expect(dav.nodes.has("/files/README.txt")).toBe(isKept);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "README.txt" }) !== null).toBe(isKept),
    );
  });

  it.each([
    ["README.txt", "/", "Choose a folder inside a mount, such as /files."],
    ["README.txt", "/files", "Choose another folder than the one they are in."],
    ["README.txt", "/files/../photos", "Name the folder without . or .. in its path."],
    ["Drafts", "/files/Drafts/Old", "A folder cannot go inside itself."],
    ["README.txt", "/files/Nowhere", "The destination folder does not exist."],
    ["blog", "/photos", "/photos is no longer there."],
  ])("moving %s to %s is refused: %s", async (name, destination, problem) => {
    const dav = seeded().file("/files/blog");
    await open("/files", { dav });
    await link("README.txt");
    // The entry leaves the server once the listing shows it, so the move finds nothing.
    if (name === "blog") {
      dav.nodes.delete("/files/blog");
    }
    await chooseAction(name, "Move");
    const form = await submitDialog(destination, "Move");
    expect(await within(form).findByText(problem)).toBeTruthy();
  });

  it("copying a name already at the destination copies nothing", async () => {
    const dav = seeded().file("/files/Drafts/README.txt", { body: "older" });
    await open("/files", { dav });
    await chooseAction("README.txt", "Copy");
    const form = await submitDialog("/files/Drafts", "Copy");
    expect(
      await within(form).findByText("Something named “README.txt” is already in /files/Drafts."),
    ).toBeTruthy();
    expect(dav.nodes.get("/files/Drafts/README.txt")?.body).toBe("older");
  });

  it("moves the selected rows together, and stops at the first refusal", async () => {
    const dav = seeded().file("/files/Drafts/README.txt", { body: "older" });
    await open("/files", { dav });
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select budget.xlsx" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select README.txt" }));
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    const form = await submitDialog("/files/Drafts", "Move");
    expect(
      await within(form).findByText(
        "Moved “budget.xlsx”, then: Something named “README.txt” is already in /files/Drafts.",
      ),
    ).toBeTruthy();
    expect(dav.nodes.has("/files/Drafts/budget.xlsx")).toBe(true);
    expect(dav.nodes.has("/files/README.txt")).toBe(true);
  });

  it("copies the selected rows together", async () => {
    const { dav } = await open("/files");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select budget.xlsx" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select README.txt" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect((await dialog()).textContent).toContain("Copy 2 items");
    await submitDialog("/files/Archive", "Copy");
    expect(await said("Copied 2 items to /files/Archive.")).toBeTruthy();
    expect(dav.paths()).toContain("/files/Archive/budget.xlsx");
    expect(dav.paths()).toContain("/files/README.txt");
  });

  it("moving the file whose details are open closes them", async () => {
    const { router, calls } = await open("/files", { selectedName: "README.txt" });
    await screen.findByText(README.trim());
    await chooseAction("README.txt", "Move");
    await submitDialog("/files/Drafts", "Move");
    await said("Moved “README.txt” to /files/Drafts.");
    await waitFor(() => expect(router.state.location.search).toEqual({ path: "/files" }));
    expect(calls.filter((call) => call.method === "MOVE")).toHaveLength(1);
  });
});

describe("deleting", () => {
  it("two selected files asks first, then deletes both", async () => {
    const { dav } = await open("/files");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select budget.xlsx" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select README.txt" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirmation = await screen.findByRole("alertdialog");
    expect(within(confirmation).getByText("Delete 2 items?")).toBeTruthy();
    expect(within(confirmation).getByText("This cannot be undone.")).toBeTruthy();
    await userEvent.click(within(confirmation).getByRole("button", { name: "Delete" }));
    expect(await said("Deleted 2 items.")).toBeTruthy();
    expect(dav.nodes.has("/files/budget.xlsx")).toBe(false);
    expect(dav.nodes.has("/files/README.txt")).toBe(false);
    await waitFor(() => expect(filesListed()).toEqual(["Quarterly report.pdf"]));
  });

  it("a folder deletes what it holds", async () => {
    const { dav } = await open("/files");
    await chooseAction("Drafts", "Delete");
    const confirmation = await screen.findByRole("alertdialog");
    expect(within(confirmation).getByText("Delete “Drafts”?")).toBeTruthy();
    await userEvent.click(within(confirmation).getByRole("button", { name: "Delete" }));
    expect(await said("Deleted “Drafts”.")).toBeTruthy();
    expect(dav.paths().some((path) => path.startsWith("/files/Drafts"))).toBe(false);
  });

  it("says why the server refused, after deleting what it could", async () => {
    const dav = seeded();
    dav.refusals.set("DELETE /files/README.txt", 423);
    await open("/files", { dav });
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select budget.xlsx" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select README.txt" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    expect(await said("Another client has locked it.")).toBeTruthy();
    expect(dav.nodes.has("/files/budget.xlsx")).toBe(false);
    expect(dav.nodes.has("/files/README.txt")).toBe(true);
  });

  it("the file whose details are open closes them", async () => {
    const { router, dav } = await open("/files", { selectedName: "README.txt" });
    await screen.findByText(README.trim());
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    expect(await said("Deleted “README.txt”.")).toBeTruthy();
    expect(dav.nodes.has("/files/README.txt")).toBe(false);
    await waitFor(() => expect(router.state.location.search).toEqual({ path: "/files" }));
  });
});

describe("the selection", () => {
  it("offers its actions until a search clears it", async () => {
    await open("/files");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select budget.xlsx" }));
    expect(screen.getByRole("button", { name: "Move" })).toBeTruthy();
    await userEvent.type(search(), "b");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Move" })).toBeNull());
  });

  it("can be cleared from its toolbar", async () => {
    await open("/files");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select budget.xlsx" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select README.txt" }));
    await userEvent.click(screen.getByRole("button", { name: "Unselect All" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Move" })).toBeNull());
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: "Select README.txt" }).checked,
    ).toBe(false);
  });
});

/** Catches the link a download clicks, which the browser would save from. */
const capture = () => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }),
  );
  return vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
};

describe("downloading", () => {
  it("from a row says it is downloading and saves the file under its name", async () => {
    const click = capture();
    await open("/files");
    await chooseAction("README.txt", "Download");
    expect(await said("Downloading “README.txt”.")).toBeTruthy();
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    const saved = click.mock.contexts[0];
    expect(saved instanceof HTMLAnchorElement ? saved.download : undefined).toBe("README.txt");
  });

  it("from the details says why it failed", async () => {
    capture();
    const dav = seeded();
    await open("/files", { dav, selectedName: "budget.xlsx" });
    await screen.findByText("No preview for this kind of file.");
    dav.refusals.set("GET /files/budget.xlsx", 404);
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await said("/files is no longer there.")).toBeTruthy();
  });
});

/** The drop zone's file input, which assistive technology does not see. */
const filesInput = () => {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("The upload panel has no file input.");
  }
  return input;
};

const openUpload = async (dav: FakeDav) => {
  dav.installUploads();
  await open("/files", { dav });
  await link("README.txt");
  await userEvent.click(screen.getByRole("button", { name: "Upload" }));
  expect(await screen.findByRole("heading", { name: "Upload" })).toBeTruthy();
};

describe("uploading", () => {
  it("stores a file, shows its progress, and reports it", async () => {
    const dav = seeded();
    dav.held.add("PUT /files/notes.md");
    await openUpload(dav);
    await userEvent.upload(
      filesInput(),
      new File(["# Notes\n"], "notes.md", { type: "text/markdown" }),
    );
    expect(await screen.findByRole("progressbar", { name: "Uploading notes.md" })).toBeTruthy();
    expect(screen.getByText(/ of 8 bytes$/)).toBeTruthy();
    dav.release();
    expect(await said("Uploaded 1 file to /files.")).toBeTruthy();
    expect(screen.getByText("Uploaded to /files")).toBeTruthy();
    expect(dav.nodes.get("/files/notes.md")).toMatchObject({
      body: "# Notes\n",
      contentType: "text/markdown",
    });
    expect(await link("notes.md")).toBeTruthy();
  });

  it("reports each file that failed, and why", async () => {
    const dav = seeded();
    dav.refusals.set("PUT /files/full.txt", 507);
    await openUpload(dav);
    const huge = new File(["x"], "huge.bin");
    Object.defineProperty(huge, "size", { value: 150_000_000 });
    await userEvent.upload(filesInput(), [
      new File(["ok"], "ok.txt"),
      huge,
      new File(["x"], "Drafts"),
      new File(["x"], "full.txt"),
    ]);
    expect(await said("3 of 4 uploads failed.")).toBeTruthy();
    expect(
      screen.getByText("Over the 100 MB limit for one request on Cloudflare Free."),
    ).toBeTruthy();
    expect(screen.getByText("A folder named “Drafts” is already here.")).toBeTruthy();
    expect(screen.getByText("The storage backend is full.")).toBeTruthy();
    expect(screen.getAllByText("Failed")).toHaveLength(3);
    expect(dav.nodes.has("/files/ok.txt")).toBe(true);
    expect(dav.nodes.get("/files/Drafts")?.kind).toBe("folder");
  });

  it("says when the one upload failed, and Clear finished takes the rows away", async () => {
    const dav = seeded();
    dav.refusals.set("PUT /files/a.txt", 0);
    await openUpload(dav);
    await userEvent.upload(filesInput(), new File(["a"], "a.txt"));
    expect(await said("1 of 1 upload failed.")).toBeTruthy();
    expect(
      screen.getByText("Davloom could not be reached. Check the connection and try again."),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Clear finished" }));
    await waitFor(() => expect(screen.queryByText("Failed")).toBeNull());
    expect(screen.queryByRole("button", { name: "Clear finished" })).toBeNull();
  });

  it("closes again with the Upload button", async () => {
    await openUpload(seeded());
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Upload" })).toBeNull());
  });
});

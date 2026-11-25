import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DavError } from "../api/dav";
import { renderPage } from "../../test/render";
import { NameForm, TransferForm } from "./dialogs";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Submit = (value: string) => Promise<string | undefined>;

/** A submit that answers only when the test says so. */
const deferred = () => {
  const answers: ((problem: string | undefined) => void)[] = [];
  const onSubmit = vi.fn<Submit>(
    () =>
      new Promise((resolve) => {
        answers.push(resolve);
      }),
  );
  const answer = (problem: string | undefined) => {
    for (const resolve of answers) {
      resolve(problem);
    }
  };
  return { onSubmit, answer };
};

/** The form's field, whose name also says it is required. */
const field = (label: string) =>
  screen.getByRole<HTMLInputElement>("textbox", { name: new RegExp(`^${label}`) });

describe("NameForm", () => {
  it("starts from the name it is given, and submits what the field holds on Enter", async () => {
    const onSubmit = vi.fn<Submit>(async () => undefined);
    await renderPage(
      <NameForm
        title="Rename “a.txt”"
        submitLabel="Rename"
        initialName="a.txt"
        onCancel={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText("Rename “a.txt”")).toBeTruthy();
    expect(field("Name").value).toBe("a.txt");
    await userEvent.type(field("Name"), "{Backspace}{Backspace}{Backspace}md{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("a.md");
  });

  it("sends one submit at a time, and shows the reason it refused", async () => {
    const { onSubmit, answer } = deferred();
    await renderPage(
      <NameForm
        title="New folder"
        submitLabel="Create folder"
        onCancel={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.type(field("Name"), "Drafts");
    const submit = screen.getByRole("button", { name: "Create folder" });
    await userEvent.click(submit);
    await userEvent.type(field("Name"), "{Enter}");
    expect(onSubmit).toHaveBeenCalledOnce();
    answer("Something with this name is already here.");
    expect(await screen.findByText("Something with this name is already here.")).toBeTruthy();
    expect(field("Name").getAttribute("aria-invalid")).toBe("true");
    await userEvent.type(field("Name"), "2");
    await waitFor(() => expect(field("Name").getAttribute("aria-invalid")).not.toBe("true"));
  });

  it("calls onCancel from Cancel", async () => {
    const onCancel = vi.fn();
    await renderPage(
      <NameForm
        title="New folder"
        submitLabel="Create folder"
        onCancel={onCancel}
        onSubmit={async () => undefined}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

const folderButton = (name: string) => screen.findByRole("button", { name });

describe("TransferForm", () => {
  /** A namespace of two mounts: /files with Archive, Drafts and Drafts/Old, and an empty /photos. */
  const FOLDERS: Record<string, string[]> = {
    "/files": ["Drafts", "Archive"],
    "/files/Drafts": ["Old"],
    "/files/Drafts/Old": [],
    "/files/Archive": [],
    "/photos": [],
  };
  const listFolders = vi.fn(async (parts: readonly string[]) => {
    const found = FOLDERS[`/${parts.join("/")}`];
    if (found === undefined) {
      throw new DavError(404);
    }
    return found;
  });

  const form = (props: Partial<Parameters<typeof TransferForm>[0]> = {}) => (
    <TransferForm
      transfer="move"
      names={["a.txt"]}
      from="/files"
      mounts={["files", "photos"]}
      listFolders={listFolders}
      onCancel={() => undefined}
      onSubmit={async () => undefined}
      {...props}
    />
  );

  it.each([
    ["move", ["a.txt"], "Move “a.txt”", "Move here"],
    ["copy", ["a.txt"], "Copy “a.txt”", "Copy here"],
    ["move", ["a.txt", "b.txt", "Drafts"], "Move 3 items", "Move here"],
    ["copy", ["a.txt", "b.txt"], "Copy 2 items", "Copy here"],
  ] as const)("%s of %j is titled %s", async (transfer, names, title, verb) => {
    const onSubmit = vi.fn<Submit>(async () => undefined);
    await renderPage(form({ transfer, names, onSubmit }));
    expect(screen.getByText(title)).toBeTruthy();
    expect(await folderButton("Archive")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: verb }));
    expect(onSubmit).toHaveBeenCalledWith("/files");
  });

  it("opens a folder, goes back up by the path, and submits the folder shown", async () => {
    const onSubmit = vi.fn<Submit>(async () => undefined);
    await renderPage(form({ onSubmit }));
    const destination = screen.getByRole("navigation", { name: "Destination" });
    await userEvent.click(await folderButton("Drafts"));
    await userEvent.click(await folderButton("Old"));
    expect(await screen.findByText("No folders inside")).toBeTruthy();
    expect(destination.textContent).toContain("Old");
    await userEvent.click(within(destination).getByText("Files"));
    expect(await folderButton("photos")).toBeTruthy();
    await userEvent.click(await folderButton("photos"));
    await userEvent.click(screen.getByRole("button", { name: "Move here" }));
    expect(onSubmit).toHaveBeenCalledWith("/photos");
  });

  it("keeps a folder that is moved, and what is inside it, from being opened", async () => {
    await renderPage(form({ names: ["Drafts", "a.txt"] }));
    const drafts = await folderButton("Drafts");
    expect(drafts.getAttribute("aria-disabled")).toBe("true");
    expect((await folderButton("Archive")).getAttribute("aria-disabled")).not.toBe("true");
  });

  it("offers only the mounts it is given at the top", async () => {
    await renderPage(form({ from: "/", mounts: ["files"] }));
    expect(await folderButton("files")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "photos" })).toBeNull();
  });

  it("says why a folder cannot be listed", async () => {
    await renderPage(form({ from: "/gone" }));
    expect(await screen.findByText("/gone is no longer there.")).toBeTruthy();
  });

  it("shows the reason it refused, and clears it on a move to another folder", async () => {
    const { onSubmit, answer } = deferred();
    await renderPage(form({ onSubmit }));
    await folderButton("Archive");
    await userEvent.click(screen.getByRole("button", { name: "Move here" }));
    answer("Choose another folder than the one they are in.");
    expect(await screen.findByText("Choose another folder than the one they are in.")).toBeTruthy();
    await userEvent.click(await folderButton("Archive"));
    await waitFor(() =>
      expect(screen.queryByText("Choose another folder than the one they are in.")).toBeNull(),
    );
  });
});

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("TransferForm", () => {
  it.each([
    ["move", ["a.txt"], "Move “a.txt”", "Move"],
    ["copy", ["a.txt"], "Copy “a.txt”", "Copy"],
    ["move", ["a.txt", "b.txt", "Drafts"], "Move 3 items", "Move"],
    ["copy", ["a.txt", "b.txt"], "Copy 2 items", "Copy"],
  ] as const)("%s of %j is titled %s", async (transfer, names, title, verb) => {
    const onSubmit = vi.fn<Submit>(async () => undefined);
    await renderPage(
      <TransferForm
        transfer={transfer}
        names={names}
        initialDestination="/files"
        onCancel={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText(title)).toBeTruthy();
    expect(field("Destination folder").value).toBe("/files");
    await userEvent.click(screen.getByRole("button", { name: verb }));
    expect(onSubmit).toHaveBeenCalledWith("/files");
  });

  it("submits on Enter, and clears the reason it refused once the path changes", async () => {
    const { onSubmit, answer } = deferred();
    await renderPage(
      <TransferForm
        transfer="move"
        names={["a.txt"]}
        initialDestination="/files"
        onCancel={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.type(field("Destination folder"), "/Nowhere{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("/files/Nowhere");
    answer("The destination folder does not exist.");
    expect(await screen.findByText("The destination folder does not exist.")).toBeTruthy();
    await userEvent.type(field("Destination folder"), "x");
    await waitFor(() =>
      expect(field("Destination folder").getAttribute("aria-invalid")).not.toBe("true"),
    );
  });
});

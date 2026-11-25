import { Button } from "@astryxdesign/core/Button";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderPage } from "../../test/render";
import { buttonLabelled, buttonNamed, inMain, linkTo, refocusIfLost } from "./focus";
import { RouterLink } from "./RouterLink";
import { nextFormKey, useFormDialog } from "./useFormDialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("RouterLink", () => {
  // What the browser was left to do with each click: the page stops it, so happy-dom loads nothing.
  let leftToBrowser: boolean[] = [];
  const record = (event: MouseEvent) => {
    leftToBrowser.push(!event.defaultPrevented);
    event.preventDefault();
  };
  beforeEach(() => {
    leftToBrowser = [];
    document.addEventListener("click", record);
  });
  afterEach(() => document.removeEventListener("click", record));

  it.each([
    ["an in-app path", { href: "/files?path=%2Ffiles" }, {}, "/files?path=%2Ffiles"],
    ["an external URL", { href: "https://example.com/" }, {}, "/"],
    ["a protocol-relative URL", { href: "//example.com/" }, {}, "/"],
    ["a link with a target", { href: "/files", target: "_blank" }, {}, "/"],
    ["a middle click", { href: "/files" }, { button: 1 }, "/"],
    ["a Ctrl click", { href: "/files" }, { ctrlKey: true }, "/"],
    ["a Meta click", { href: "/files" }, { metaKey: true }, "/"],
    ["a Shift click", { href: "/files" }, { shiftKey: true }, "/"],
    ["an Alt click", { href: "/files" }, { altKey: true }, "/"],
    ["a link without href", {}, {}, "/"],
  ])("on %s goes to %j", async (_, props, init, href) => {
    const { router } = await renderPage(<RouterLink {...props}>Open</RouterLink>);
    fireEvent.click(screen.getByText("Open"), init);
    await waitFor(() => expect(router.state.location.href).toBe(href));
    expect(leftToBrowser).toEqual([href === "/"]);
  });

  it("leaves a click its own handler stopped, after calling that handler", async () => {
    const onClick = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const { router } = await renderPage(
      <RouterLink href="/files" onClick={onClick}>
        Open
      </RouterLink>,
    );
    fireEvent.click(screen.getByText("Open"));
    expect(onClick).toHaveBeenCalledOnce();
    expect(router.state.location.href).toBe("/");
  });
});

/** A page with controls inside the main landmark and one outside it. */
const page = () => {
  document.body.innerHTML = `
    <button aria-label="Outside">Outside</button>
    <div role="main">
      <a href="/files">Files</a><a href="/files/x">X</a>
      <button>Delete</button><button aria-label="More for a">…</button>
      <input id="field" />
    </div>`;
};
const frames = (count: number) => vi.advanceTimersByTime(17 * count);
const focused = () => document.activeElement?.textContent ?? "";

describe("focus", () => {
  // Frames and the clock run only when a test moves them, so no watch outlives its test.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "performance"] });
  });
  afterEach(() => {
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });
  it.each([
    ["linkTo /files", () => linkTo("/files")?.textContent, "Files"],
    ["linkTo a missing path", () => linkTo("/storage"), undefined],
    ["buttonNamed Delete", () => buttonNamed("Delete")?.textContent, "Delete"],
    ["buttonNamed Outside", () => buttonNamed("Outside"), undefined],
    ["buttonLabelled More for a", () => buttonLabelled("More for a")?.textContent, "…"],
    ["buttonLabelled Outside", () => buttonLabelled("Outside"), undefined],
    ["inMain button", () => inMain("button").length, 2],
  ])("%s finds %j", (_, find, expected) => {
    page();
    expect(find()).toBe(expected);
  });

  it("moves focus that fell to the body", () => {
    page();
    document.body.focus();
    refocusIfLost(() => buttonNamed("Delete"));
    expect(focused()).not.toBe("Delete");
    frames(1);
    expect(focused()).toBe("Delete");
  });

  it("moves focus off an element that left the page", () => {
    page();
    const field = document.querySelector<HTMLInputElement>("#field");
    field?.focus();
    field?.remove();
    refocusIfLost(() => buttonNamed("Delete"));
    frames(1);
    expect(focused()).toBe("Delete");
  });

  it("leaves focus that something else holds", () => {
    page();
    document.querySelector<HTMLInputElement>("#field")?.focus();
    refocusIfLost(() => buttonNamed("Delete"));
    frames(10);
    expect(document.activeElement?.id).toBe("field");
  });

  it("stops once focus moves on after it placed focus", () => {
    page();
    document.body.focus();
    refocusIfLost(() => buttonNamed("Delete"));
    frames(1);
    document.querySelector<HTMLInputElement>("#field")?.focus();
    frames(1);
    document.querySelector<HTMLElement>("a")?.focus();
    document.querySelector<HTMLElement>("a")?.blur();
    frames(10);
    expect(focused()).not.toBe("Delete");
  });

  it("keeps watching while nothing can take focus, and places it once something can", () => {
    page();
    document.body.focus();
    let isThere = false;
    refocusIfLost(() => (isThere ? buttonNamed("Delete") : null));
    frames(5);
    expect(focused()).not.toBe("Delete");
    isThere = true;
    frames(1);
    expect(focused()).toBe("Delete");
  });

  it("gives up after a second", () => {
    page();
    document.body.focus();
    const find = vi.fn(() => null);
    refocusIfLost(find);
    vi.advanceTimersByTime(900);
    const watched = find.mock.calls.length;
    expect(watched).toBeGreaterThan(10);
    vi.advanceTimersByTime(5000);
    const settled = find.mock.calls.length;
    expect(settled - watched).toBeLessThan(10);
    vi.advanceTimersByTime(5000);
    expect(find.mock.calls.length).toBe(settled);
  });
});

describe("nextFormKey", () => {
  it("is new on every call", () => {
    const made = Array.from({ length: 5 }, nextFormKey);
    expect(new Set(made).size).toBe(5);
    expect(made.every((key) => key.startsWith("form-"))).toBe(true);
  });
});

/** A page with openers and a dialog whose form has a field that focuses itself. */
const DialogPage = () => {
  const dialog = useFormDialog(400);
  const [isRenameShown, setIsRenameShown] = useState(true);
  const form = (
    <form key={nextFormKey()}>
      {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- as the Dashboard's forms do */}
      <input aria-label="Name" autoFocus />
      <Button label="Save" onClick={() => dialog.hide()} />
      <Button label="Save and go back" onClick={() => dialog.hide(() => buttonNamed("Back"))} />
      <Button
        label="Delete"
        onClick={() => {
          setIsRenameShown(false);
          dialog.hide();
        }}
      />
    </form>
  );
  return (
    <div role="main">
      {isRenameShown ? (
        <Button
          label="Rename"
          onClick={() => dialog.show(form, "Rename item", () => buttonNamed("Fallback"))}
        />
      ) : null}
      <Button label="Fallback" />
      <Button label="Back" />
      {isRenameShown ? (
        <Button label="Open bare" onClick={() => dialog.show(form, "New folder")} />
      ) : null}
      {dialog.element}
    </div>
  );
};

/**
 * A browser blurs an element inside a dialog that has closed, as the dialog no longer shows it;
 * happy-dom keeps focus there, so the tests do what the browser would.
 */
const focusedIn = (text: string) => {
  const active = document.activeElement;
  const dialog = active?.closest("dialog");
  if (active instanceof HTMLElement && dialog instanceof HTMLDialogElement && !dialog.open) {
    active.blur();
  }
  expect(document.activeElement?.textContent).toBe(text);
};

const openDialog = async (opener: string) => {
  await userEvent.click(screen.getByRole("button", { name: opener }));
  await screen.findByRole("button", { name: "Save" });
};

describe("useFormDialog", () => {
  it.each([
    ["one of its own buttons", () => userEvent.click(screen.getByRole("button", { name: "Save" }))],
    ["Escape", () => userEvent.keyboard("{Escape}")],
  ])("returns focus to its opener when it closes with %s", async (_, close) => {
    render(<DialogPage />);
    await openDialog("Rename");
    await close();
    await waitFor(() => focusedIn("Rename"));
  });

  it("returns focus where the form says", async () => {
    render(<DialogPage />);
    await openDialog("Rename");
    await userEvent.click(screen.getByRole("button", { name: "Save and go back" }));
    await waitFor(() => focusedIn("Back"));
  });

  it("falls back when the opener is gone, as the row of a deleted record", async () => {
    render(<DialogPage />);
    await openDialog("Rename");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => focusedIn("Fallback"));
  });

  it("returns focus nowhere when the opener is gone without a fallback", async () => {
    render(<DialogPage />);
    await openDialog("Open bare");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open bare" })).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(() => focusedIn("Fallback")).toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it("returns focus to an opener without a fallback", async () => {
    render(<DialogPage />);
    await openDialog("Open bare");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => focusedIn("Open bare"));
  });

  it("is named by the title of each form it shows, not only the first", async () => {
    render(<DialogPage />);
    await openDialog("Rename");
    expect(screen.getByRole("dialog", { name: "Rename item" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => focusedIn("Rename"));
    await openDialog("Open bare");
    expect(screen.getByRole("dialog", { name: "New folder" })).toBeTruthy();
  });
});

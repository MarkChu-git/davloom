import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { carryFrameInput } from "./carry";

// happy-dom lays nothing out, so every element would report no box. An element shows here unless
// it sits in a `data-hidden` part, as the frame's copies for another language or window do.
const showUnlessHidden = () => {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    const rects = this.closest("[data-hidden]") === null ? [DOMRect.fromRect({ width: 100 })] : [];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the length is all carry.ts reads
    return rects as unknown as DOMRectList;
  });
};

/** Lets the mutation callbacks and the microtasks after them run. */
const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

/** The prerendered frame: a copy of the form for each language, of which one shows. */
const FRAME = `
  <main data-frame-part>
    <section data-hidden>
      <input type="text" autocomplete="username" value="">
      <input type="password" autocomplete="current-password" value="">
    </section>
    <section>
      <input type="text" autocomplete="username" value="">
      <input type="password" autocomplete="current-password" value="">
      <input type="text" autocomplete="off" readonly value="/dav/">
      <input type="text" autocomplete="name" disabled value="">
      <input type="checkbox">
      <textarea></textarea>
      <button type="button">Sign in</button>
    </section>
  </main>`;

const frameField = (selector: string) => {
  const field = document.querySelector<HTMLInputElement>(`section:not([data-hidden]) ${selector}`);
  if (field === null) throw new Error(`no ${selector}`);
  return field;
};

/** Types into a frame field as the browser does, without React. */
const typeIntoFrame = (selector: string, value: string) => {
  const field = frameField(selector);
  field.focus();
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return field;
};

/** The page React renders in the frame's place: controlled fields that start empty. */
const SignIn = ({ onPassword }: { onPassword?: (value: string) => void }) => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  return (
    <main>
      <input
        aria-label="identifier"
        type="text"
        autoComplete="username"
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        autoFocus
      />
      <input
        aria-label="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          onPassword?.(event.target.value);
        }}
      />
      <textarea aria-label="note" value={note} onChange={(event) => setNote(event.target.value)} />
      <output>{JSON.stringify([identifier, password, note])}</output>
    </main>
  );
};

/** The page's state: what its identifier, password and note hold. */
const state = (): unknown => JSON.parse(document.querySelector("output")?.textContent ?? "null");

/** Replaces the frame with the page, as React's first commit over the document does. */
const replaceFrame = (page = <SignIn />) => {
  document.body.replaceChildren();
  return render(page);
};

let stop = () => {};

beforeEach(() => {
  showUnlessHidden();
  document.body.innerHTML = FRAME;
});

afterEach(() => {
  stop();
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("carryFrameInput", () => {
  it("gives the page's state what was typed into the frame, and the caret", async () => {
    stop = carryFrameInput();
    typeIntoFrame('[autocomplete="username"]', "admin");
    const password = typeIntoFrame('[autocomplete="current-password"]', "secret");
    password.setSelectionRange(2, 4);
    typeIntoFrame("textarea", "a note");
    frameField('[autocomplete="current-password"]').focus();

    replaceFrame();
    await settle();

    expect(state()).toEqual(["admin", "secret", "a note"]);
    const pagePassword = screen.getByLabelText<HTMLInputElement>("password");
    // The page's own autofocus went to the identifier; the caret goes back where it was.
    expect(document.activeElement).toBe(pagePassword);
    expect([pagePassword.selectionStart, pagePassword.selectionEnd]).toEqual([2, 4]);
  });

  it("carries the caret the person had when the code started", async () => {
    frameField('[autocomplete="current-password"]').focus();
    stop = carryFrameInput();
    replaceFrame();
    await settle();
    expect(document.activeElement).toBe(screen.getByLabelText("password"));
    expect(state()).toEqual(["", "", ""]);
  });

  it("leaves fields the person did not change, such as one the frame's script filled", async () => {
    // fill.ts writes a value the frame shows as the field's default.
    frameField('[autocomplete="username"]').defaultValue = "Admin";
    const onPassword = vi.fn();
    stop = carryFrameInput();
    replaceFrame(<SignIn onPassword={onPassword} />);
    await settle();
    expect(state()).toEqual(["", "", ""]);
    expect(onPassword).not.toHaveBeenCalled();
    // Nothing had focus in the frame, so the page's own autofocus stays.
    expect(document.activeElement).toBe(screen.getByLabelText("identifier"));
  });

  it("carries no caret once the person moved focus off the frame's fields", async () => {
    stop = carryFrameInput();
    typeIntoFrame('[autocomplete="current-password"]', "secret");
    frameField("button").focus();
    replaceFrame();
    await settle();
    expect(state()).toEqual(["", "secret", ""]);
    expect(document.activeElement).toBe(screen.getByLabelText("identifier"));
  });

  it("carries no caret once the field lost focus to the page itself", async () => {
    stop = carryFrameInput();
    typeIntoFrame('[autocomplete="current-password"]', "secret").blur();
    await settle();
    replaceFrame();
    await settle();
    expect(document.activeElement).toBe(screen.getByLabelText("identifier"));
  });

  it("ignores focus that the page's own fields take while the frame is still there", async () => {
    stop = carryFrameInput();
    typeIntoFrame('[autocomplete="current-password"]', "secret");
    // React puts the page in and focuses its autofocus field before the frame leaves.
    const { container } = render(<SignIn />);
    screen.getByLabelText<HTMLInputElement>("identifier").focus();
    document.body.replaceChildren(container);
    await settle();
    expect(document.activeElement).toBe(screen.getByLabelText("password"));
  });

  it("does nothing while the frame is still there", async () => {
    stop = carryFrameInput();
    typeIntoFrame('[autocomplete="username"]', "admin");
    // The frame's script writes into the frame, which the page then replaces.
    document.querySelector("main")?.append(document.createElement("span"));
    await settle();
    expect(frameField('[autocomplete="username"]').value).toBe("admin");
  });

  it("waits for fields the page renders after the frame has gone", async () => {
    stop = carryFrameInput();
    typeIntoFrame('[autocomplete="username"]', "admin");
    document.body.replaceChildren();
    render(<p>Loading</p>);
    await settle();
    cleanup();
    render(<SignIn />);
    await settle();
    expect(state()).toEqual(["admin", "", ""]);
  });

  it("stops waiting after a while, when the page never shows the field", async () => {
    vi.useFakeTimers();
    stop = carryFrameInput(document, 1000);
    typeIntoFrame('[autocomplete="username"]', "admin");
    document.body.replaceChildren();
    render(<p>Another page</p>);
    await act(async () => await vi.advanceTimersByTimeAsync(1000));
    cleanup();
    render(<SignIn />);
    await act(async () => await vi.advanceTimersByTimeAsync(0));
    expect(state()).toEqual(["", "", ""]);
  });

  it("carries nothing into a page that a redirect at startup led to", async () => {
    const start = window.location.pathname;
    stop = carryFrameInput();
    typeIntoFrame('[autocomplete="username"]', "admin");
    document.body.replaceChildren();
    window.history.replaceState(null, "", "/elsewhere");
    try {
      render(<SignIn />);
      await settle();
      expect(state()).toEqual(["", "", ""]);
    } finally {
      window.history.replaceState(null, "", start);
    }
  });

  it("watches nothing on a page whose frame has no field to type into", () => {
    document.body.innerHTML = '<main><input type="text" readonly value="/dav/"></main>';
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    stop = carryFrameInput();
    expect(observe).not.toHaveBeenCalled();
  });
});

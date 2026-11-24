/**
 * happy-dom runs the first-paint script, which is Davloom's own, as a browser runs it from <head>.
 * @vitest-environment-options {"settings": {"enableJavaScriptEvaluation": true}}
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_SCRIPT, APPEARANCE_STORAGE_KEY } from "./script";
import {
  isAppearanceMode,
  setAppearanceMode,
  useAppearanceMode,
  type AppearanceMode,
} from "./store";

beforeEach(() => {
  localStorage.clear();
  setAppearanceMode("system");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

/**
 * Storage that throws on `method`, as a private window or a full quota does. happy-dom's Storage
 * would keep a spy on it as an item, so the whole object stands in.
 */
const refuseStorage = (method: "getItem" | "setItem") => {
  const real = localStorage;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => real.getItem(key),
    setItem: (key: string, value: string) => real.setItem(key, value),
    removeItem: (key: string) => real.removeItem(key),
    [method]: () => {
      throw new DOMException("refused", "SecurityError");
    },
  });
};

/** Runs the first-paint script as the browser runs it from <head>. */
const run = () => {
  const script = document.createElement("script");
  script.textContent = APPEARANCE_SCRIPT;
  document.head.append(script);
  script.remove();
};

const Probe = () => <p>{useAppearanceMode()}</p>;

/** Another tab changing the stored mode. */
const otherTab = (key: string | null, value: string | null) => {
  if (key === APPEARANCE_STORAGE_KEY) {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  }
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  });
};

describe("the appearance store", () => {
  it.each([
    ["light", true],
    ["dark", true],
    ["system", true],
    ["sepia", false],
    ["", false],
  ])("counts %j as a mode: %s", (value, isMode) => {
    expect(isAppearanceMode(value)).toBe(isMode);
  });

  it.each<[AppearanceMode, string | null, string]>([
    ["light", "light", "light"],
    ["dark", "dark", "dark"],
    ["system", null, ""],
  ])("keeps %s in storage as %j and on <html> as %j", (mode, stored, scheme) => {
    render(<Probe />);
    act(() => setAppearanceMode(mode));
    expect(screen.getByText(mode)).toBeTruthy();
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(stored);
    expect(document.documentElement.style.colorScheme).toBe(scheme);
  });

  it("still applies a mode where storage refuses it", () => {
    refuseStorage("setItem");
    render(<Probe />);
    act(() => setAppearanceMode("dark"));
    expect(screen.getByText("dark")).toBeTruthy();
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it.each([
    [APPEARANCE_STORAGE_KEY, "dark", "dark"],
    [APPEARANCE_STORAGE_KEY, "light", "light"],
    [APPEARANCE_STORAGE_KEY, "sepia", "system"],
    [APPEARANCE_STORAGE_KEY, null, "system"],
  ])("follows another tab that sets %s to %j", (key, value, mode) => {
    act(() => setAppearanceMode(value === "light" ? "dark" : "light"));
    render(<Probe />);
    otherTab(key, value);
    expect(screen.getByText(mode)).toBeTruthy();
  });

  it("follows another tab that clears all storage", () => {
    act(() => setAppearanceMode("dark"));
    render(<Probe />);
    localStorage.clear();
    otherTab(null, null);
    expect(screen.getByText("system")).toBeTruthy();
    expect(document.documentElement.style.colorScheme).toBe("");
  });

  it("ignores another tab's change to other keys", () => {
    act(() => setAppearanceMode("dark"));
    render(<Probe />);
    otherTab("davloom.side-nav", "x");
    expect(screen.getByText("dark")).toBeTruthy();
  });

  it("falls back to system where storage cannot be read", () => {
    act(() => setAppearanceMode("dark"));
    render(<Probe />);
    refuseStorage("getItem");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_STORAGE_KEY }));
    });
    expect(screen.getByText("system")).toBeTruthy();
  });

  it.each([
    ["dark", "dark"],
    ["light", "light"],
    ["sepia", "system"],
  ])("starts a visit with a stored %j as %s", async (stored, mode) => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, stored);
    vi.resetModules();
    const fresh = await import("./store");
    const FreshProbe = () => <p>{fresh.useAppearanceMode()}</p>;
    render(<FreshProbe />);
    expect(screen.getByText(mode)).toBeTruthy();
    expect(document.documentElement.style.colorScheme).toBe(mode === "system" ? "" : mode);
  });
});

describe("the first-paint script", () => {
  it.each([
    ["dark", "dark"],
    ["light", "light"],
    ["sepia", null],
    [null, null],
  ])("puts a stored %j on <html> as %j", (stored, theme) => {
    if (stored !== null) {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, stored);
    }
    run();
    expect(document.documentElement.getAttribute("data-theme")).toBe(theme);
    expect(document.documentElement.style.colorScheme).toBe(theme ?? "");
  });

  it("does nothing where storage cannot be read", () => {
    refuseStorage("getItem");
    expect(run).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});

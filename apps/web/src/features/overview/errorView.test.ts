import { afterEach, describe, expect, it, vi } from "vitest";

// The chosen view of the recent errors, remembered in this browser where it can be.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const storage = (stored: string | null, fails = false) => ({
  getItem: () => {
    if (fails) throw new Error("blocked");
    return stored;
  },
  setItem: vi.fn(() => {
    if (fails) throw new Error("blocked");
  }),
});

describe("errorView", () => {
  it.each([
    ["a remembered view", "tiles", false, "tiles"],
    ["an unknown value", "grid", false, "list"],
    ["nothing", null, false, "list"],
    ["storage that refuses", "tiles", true, "list"],
  ])("starts from %s", async (_, stored, fails, view) => {
    vi.stubGlobal("localStorage", storage(stored, fails));
    const { currentErrorView, setErrorView } = await import("./errorView");
    expect(currentErrorView()).toBe(view);
    // Saving never throws, even where the browser keeps nothing.
    expect(() => setErrorView("timeline")).not.toThrow();
  });

  it("remembers the view chosen", async () => {
    const local = storage(null);
    vi.stubGlobal("localStorage", local);
    const { setErrorView } = await import("./errorView");
    setErrorView("timeline");
    expect(local.setItem).toHaveBeenCalledWith("davloom.overview.errorView", "timeline");
  });
});

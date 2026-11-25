import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json, renderPage } from "../../test/render";

// The Menu button's Popover attaches in a transition after the first render. Holding transitions
// back keeps the page in that moment, so a tap lands before the Popover has attached.
const held = vi.hoisted(() => ({ isHolding: false, queue: [] as (() => void)[] }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    startTransition: (callback: () => void) => {
      if (held.isHolding) {
        held.queue.push(callback);
        return;
      }
      react.startTransition(callback);
    },
  };
});

const { DashboardShell } = await import("./DashboardShell");

afterEach(() => {
  held.isHolding = false;
  held.queue = [];
  cleanup();
  vi.unstubAllGlobals();
});

it("opens the dropdown on a tap that comes before the Popover attaches", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    matches: query.includes("width <") && query.includes("768"),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  held.isHolding = true;
  await renderPage(
    <DashboardShell>
      <p>Page content</p>
    </DashboardShell>,
    {
      path: "/",
      api: { "GET /api/backends": () => json([]) },
    },
  );
  const menu = await screen.findByRole("button", { name: "Menu" });
  expect(menu.getAttribute("aria-expanded")).toBeNull();
  await userEvent.click(menu);
  const dropdown = await screen.findByRole("dialog");
  expect(within(dropdown).getByRole("link", { name: "Files" })).toBeTruthy();
  // The transition that was waiting attaches the same Popover, which stays open.
  held.isHolding = false;
  act(() => {
    for (const callback of held.queue.splice(0)) {
      callback();
    }
  });
  expect(screen.getByRole("dialog")).toBeTruthy();
});

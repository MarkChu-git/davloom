import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route as DeepRoute } from "./routes/_app/design-check/deep/page";
import { Route as DesignCheckRoute } from "./routes/_app/design-check/index";
import { renderPage } from "./test/render";

// The design check pages the compatibility tests inspect in a browser: they must work as pages
// first, so a failing inspection points at the design system rather than at the page.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the design check page", () => {
  it("opens its dialog and records the menu action chosen", async () => {
    const DesignCheck = DesignCheckRoute.options.component;
    if (DesignCheck === undefined) throw new Error("the route has no component");
    await renderPage(<DesignCheck />);
    expect(screen.getByRole("heading", { name: "Design check" })).toBeTruthy();
    expect(screen.getByTestId("last-action").textContent).toBe("None");
    await userEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(await screen.findByRole("dialog", { name: "Design check dialog" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    for (const action of ["Rename", "Delete"]) {
      await userEvent.click(screen.getByRole("button", { name: "Actions" }));
      const menu = await screen.findByRole("menu", { name: "Actions" });
      // A menu's popover never opens in happy-dom, so user-event takes its items for unclickable.
      fireEvent.click(within(menu).getByRole("menuitem", { name: action }));
      expect(screen.getByTestId("last-action").textContent).toBe(action);
    }
  });

  it("has a deep route", async () => {
    const Deep = DeepRoute.options.component;
    if (Deep === undefined) throw new Error("the route has no component");
    await renderPage(<Deep />);
    expect(screen.getByRole("heading", { name: "Deep route" })).toBeTruthy();
  });
});

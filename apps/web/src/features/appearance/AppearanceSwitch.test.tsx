import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AppearanceSwitch } from "./AppearanceSwitch";

afterEach(cleanup);

describe("AppearanceSwitch", () => {
  it("offers three modes and switches between them", async () => {
    render(<AppearanceSwitch />);
    const dark = screen.getByRole("radio", { name: "Dark" });
    await userEvent.click(dark);
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Light",
      "Dark",
      "System",
    ]);
  });
});

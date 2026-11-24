import { Theme } from "@astryxdesign/core/theme";
import { davloomTheme } from "@davloom/ui/themes/davloom";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ExpandableList, ExpandableRows, type ExpandableRecord } from "./ExpandableList";

afterEach(cleanup);

const themed = (ui: ReactNode) => (
  <Theme theme={davloomTheme} mode="light">
    {ui}
  </Theme>
);

const record = (id: string, extra: Partial<ExpandableRecord> = {}): ExpandableRecord => ({
  id,
  title: `Key ${id}`,
  summary: `dav_${id}…`,
  details: <p>Details of {id}</p>,
  toggleLabel: `Details for key ${id}`,
  ...extra,
});

const toggle = (id: string) => screen.getByRole("button", { name: `Details for key ${id}` });

describe("ExpandableList", () => {
  it.each([
    ["a string title, meta and an icon", record("a", { meta: "2 days ago", icon: <i>!</i> })],
    ["a node title without meta", record("a", { title: <strong>Key a</strong> })],
  ])("shows a row with %s, closed", (_, row) => {
    render(themed(<ExpandableList records={[row]} />));
    expect(screen.getByText("Key a")).toBeTruthy();
    expect(screen.getByText("dav_a…")).toBeTruthy();
    expect(toggle("a").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Details of a")).toBeNull();
  });

  it("shows the meta beside the chevron", () => {
    render(themed(<ExpandableList records={[record("a", { meta: "2 days ago" })]} />));
    expect(screen.getByText("2 days ago")).toBeTruthy();
  });

  it("opens a row in place, keeps several open, and closes one on a second tap", async () => {
    render(themed(<ExpandableList records={[record("a"), record("b")]} />));
    await userEvent.click(toggle("a"));
    await userEvent.click(toggle("b"));
    expect(toggle("a").getAttribute("aria-expanded")).toBe("true");
    const details = screen.getByRole("group", { name: "Details for key a" });
    expect(details.textContent).toBe("Details of a");
    expect(toggle("a").getAttribute("aria-controls")).toBe(details.id);
    expect(screen.getByText("Details of b")).toBeTruthy();
    await userEvent.click(toggle("a"));
    expect(screen.queryByText("Details of a")).toBeNull();
    expect(toggle("a").getAttribute("aria-controls")).toBeNull();
    expect(screen.getByText("Details of b")).toBeTruthy();
  });

  it("forgets that a row was open once its record leaves the list", async () => {
    const { rerender } = render(themed(<ExpandableList records={[record("a"), record("b")]} />));
    await userEvent.click(toggle("a"));
    rerender(themed(<ExpandableList records={[record("b")]} />));
    expect(screen.queryByText("Key a")).toBeNull();
    rerender(themed(<ExpandableList records={[record("a"), record("b")]} />));
    expect(toggle("a").getAttribute("aria-expanded")).toBe("false");
  });

  it("hands its card to the ref", () => {
    const ref = createRef<HTMLElement>();
    render(themed(<ExpandableList records={[record("a")]} ref={ref} />));
    expect(ref.current?.textContent).toContain("Key a");
  });

  it.each(["padded", "outset"] as const)("lays rows out %s", (edge) => {
    render(themed(<ExpandableRows records={[record("a")]} edge={edge} />));
    expect(screen.getByText("Key a")).toBeTruthy();
  });
});

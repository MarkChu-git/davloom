import { Theme } from "@astryxdesign/core/theme";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { BrandMark, LoomMark } from "../index";
import { davloomTheme } from "../themes/davloom.js";

afterEach(cleanup);

/** The class of the element that sizes a mark: Icon's box, hidden from assistive technology. */
const box = (svg: Element | undefined) =>
  svg?.closest("[aria-hidden='true']")?.getAttribute("class");

const themed = (mode: "light" | "dark", ui: ReactNode) =>
  render(
    <Theme theme={davloomTheme} mode={mode}>
      {ui}
    </Theme>,
  );

describe("BrandMark", () => {
  it("names the product on the brand color", () => {
    themed("light", <BrandMark />);
    const mark = screen.getByTestId("brand-mark");
    expect(mark.textContent).toBe("Davloom");
    expect(mark.className).not.toBe("");
  });
});

describe("LoomMark", () => {
  it.each(["light", "dark"] as const)("draws the planet and its ring in %s mode", (mode) => {
    const { container } = themed(mode, <LoomMark />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 32 32");
    expect(svg?.querySelectorAll("ellipse")).toHaveLength(1);
    expect(svg?.querySelectorAll("circle[fill='currentColor']")).toHaveLength(1);
  });

  it("draws the large mark at a size of its own, with the same artwork", () => {
    const { container } = themed(
      "light",
      <>
        <LoomMark />
        <LoomMark size="large" />
      </>,
    );
    const [small, large] = [...container.querySelectorAll("svg")];
    expect(large?.getAttribute("viewBox")).toBe("0 0 32 32");
    expect(box(large)).toBeTruthy();
    expect(box(large)).not.toBe(box(small));
  });

  it("is hidden from assistive technology, as the name beside it names the link", () => {
    const { container } = themed("light", <LoomMark />);
    expect(container.querySelector("svg")?.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("gives each mark its own gradient and masks, so two on a page do not share them", () => {
    const { container } = themed(
      "light",
      <>
        <LoomMark />
        <LoomMark />
      </>,
    );
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    for (const element of container.querySelectorAll("[mask]")) {
      const id = /^url\(#(.+)\)$/.exec(element.getAttribute("mask") ?? "")?.[1];
      expect(ids).toContain(id);
    }
    for (const ellipse of container.querySelectorAll("ellipse")) {
      const id = /^url\(#(.+)\)$/.exec(ellipse.getAttribute("stroke") ?? "")?.[1];
      expect(ids).toContain(id);
    }
  });
});

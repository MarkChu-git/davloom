import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NARROW_PAGE_WIDTH, NAV_WIDTH, useIsNarrowPage, usePageGutter } from "./pageWidth";
import { guess, useNarrowerThan } from "./useNarrowerThan";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Lays every element out `width` pixels wide. */
const widthOf = (width: () => number) =>
  vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(() => DOMRect.fromRect({ width: width(), height: 10 }));

const PageProbe = () => <p>{useIsNarrowPage() ? "narrow" : "wide"}</p>;
const GutterProbe = () => <p>gutter {usePageGutter()}</p>;

describe("useIsNarrowPage", () => {
  it("keeps 776 px beside the navigation's default width", () => {
    expect(NARROW_PAGE_WIDTH).toBe(776);
    expect(NAV_WIDTH.minWidth).toBeLessThan(NAV_WIDTH.defaultWidth);
  });

  it.each([
    [NARROW_PAGE_WIDTH + NAV_WIDTH.defaultWidth, "narrow"],
    [NARROW_PAGE_WIDTH + NAV_WIDTH.defaultWidth + 1, "wide"],
  ])("without a main region, a %i px window is %s", (innerWidth, layout) => {
    vi.stubGlobal("innerWidth", innerWidth);
    render(<PageProbe />);
    expect(screen.getByText(layout)).toBeTruthy();
  });

  it("follows the main region's own width as it changes", () => {
    let width = 900;
    widthOf(() => width);
    render(
      <div role="main">
        <PageProbe />
      </div>,
    );
    expect(screen.getByText("wide")).toBeTruthy();
    width = NARROW_PAGE_WIDTH;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByText("narrow")).toBeTruthy();
  });

  it("stops listening once it unmounts", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<PageProbe />);
    unmount();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});

describe("usePageGutter", () => {
  it("is 24 px beside the side navigation", () => {
    render(<GutterProbe />);
    expect(screen.getByText("gutter 6")).toBeTruthy();
  });
});

const NarrowProbe = ({ rem, isShown = true }: { rem: number; isShown?: boolean }) => {
  const [ref, isNarrower] = useNarrowerThan(rem);
  return isShown ? <p ref={ref}>{isNarrower ? "narrower" : "roomy"}</p> : <p>absent</p>;
};

describe("useNarrowerThan", () => {
  it.each([
    [383, 24, "narrower"],
    [384, 24, "roomy"],
    [479, 30, "narrower"],
    [480, 30, "roomy"],
  ])("a %i px element is, against %i rem, %s", (width, rem, words) => {
    widthOf(() => width);
    render(<NarrowProbe rem={rem} />);
    expect(screen.getByText(words)).toBeTruthy();
  });

  it("measures an element that appears later", () => {
    widthOf(() => 100);
    const { rerender } = render(<NarrowProbe rem={24} isShown={false} />);
    expect(screen.getByText("absent")).toBeTruthy();
    rerender(<NarrowProbe rem={24} />);
    expect(screen.getByText("narrower")).toBeTruthy();
  });
});

describe("guess", () => {
  // The page's content is the window less 16 px on each side on a phone and 24 px beside the side
  // navigation: an element whose page content is narrower than `rem` is taken to be narrower.
  it.each([
    [415, 24, true],
    [416, 24, false],
    [412, 24, true],
    [360, 21, true],
    [368, 21, false],
    // Beside the navigation the gutters are wider, so a wider window can leave less room.
    [767, 45.5, false],
    [768, 45.5, true],
    [975, 58, true],
    [976, 58, false],
    [1280, 58, false],
  ])("a %i px window, against %i rem, guesses narrower: %s", (windowWidth, rem, isNarrower) => {
    expect(guess(rem, windowWidth)).toBe(isNarrower);
  });

  it("is never narrower where the page's content leaves the element room", () => {
    for (let windowWidth = 320; windowWidth <= 2000; windowWidth += 7) {
      const gutters = windowWidth < 768 ? 32 : 48;
      for (const rem of [21, 24, 30, 32, 37, 39, 58]) {
        expect(guess(rem, windowWidth)).toBe(windowWidth - gutters < rem * 16);
      }
    }
  });
});

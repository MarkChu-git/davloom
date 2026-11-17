import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { useLayoutEffect, useState } from "react";

/**
 * Width of the side navigation in pixels. Let go narrower than 160 px, or flung towards there, its
 * edge folds it to the icon rail: Astryx SideNav projects a moving release forward. Let go at rest
 * between 160 px and the minimum, it springs back to the minimum. The browser keeps the chosen
 * width and state between visits.
 */
export const NAV_WIDTH = { defaultWidth: 248, minWidth: 200, maxWidth: 400 } as const;

/**
 * The widest page, beside the side navigation, that Settings and Files lay out as narrow: a window
 * 1024 px wide less the navigation's default width, 776 px. The page's own width decides rather
 * than the window's, so widening the navigation narrows the page, and folding it widens the page.
 */
export const NARROW_PAGE_WIDTH = 1024 - NAV_WIDTH.defaultWidth;

/**
 * The space between a page's edges and its content, as an Astryx spacing step. Beside the side
 * navigation it is 24 px, the inset the navigation keeps from the window's edge, so the two share
 * one grid; on a phone, where the navigation drops down from the bar across the top, it is 16 px.
 */
export const usePageGutter = (): 4 | 6 => (useAppShellMobile().isMobile ? 4 : 6);

/** The main region AppShell draws around each page. */
const mainRegion = (): Element | null => document.querySelector('[role="main"]');

const isNarrow = (): boolean => {
  const region = mainRegion();
  return region === null
    ? window.innerWidth <= NARROW_PAGE_WIDTH + NAV_WIDTH.defaultWidth
    : region.getBoundingClientRect().width <= NARROW_PAGE_WIDTH;
};

/**
 * Whether the page beside the side navigation is narrow enough for the narrow layouts. The first
 * render guesses from the window; the measure that follows runs before the browser paints, so a
 * wrong guess is never seen.
 */
export const useIsNarrowPage = (): boolean => {
  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth <= NARROW_PAGE_WIDTH + NAV_WIDTH.defaultWidth,
  );
  useLayoutEffect(() => {
    const update = () => setNarrow(isNarrow());
    update();
    const observer = new ResizeObserver(update);
    const region = mainRegion();
    if (region !== null) {
      observer.observe(region);
    }
    // The window's own changes reach a region that AppShell drew again.
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return narrow;
};

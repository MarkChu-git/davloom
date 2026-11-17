import { useLayoutEffect, useState } from "react";

/**
 * The widest page, beside the side navigation, that Settings and Files lay out as narrow: a window
 * 1024 px wide less the navigation's default 248 px. The page's own width decides rather than the
 * window's, so widening the navigation narrows the page, and folding it widens the page.
 */
export const NARROW_PAGE_WIDTH = 776;

const DEFAULT_NAVIGATION_WIDTH = 248;

/** The main region AppShell draws around each page. */
const mainRegion = (): Element | null => document.querySelector('[role="main"]');

const isNarrow = (): boolean => {
  const region = mainRegion();
  return region === null
    ? window.innerWidth <= NARROW_PAGE_WIDTH + DEFAULT_NAVIGATION_WIDTH
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
      window.innerWidth <= NARROW_PAGE_WIDTH + DEFAULT_NAVIGATION_WIDTH,
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

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

// A large folder (PRD §8.2) renders only the rows near the viewport, with a spacer row in place of
// the rest above and below, so a folder of 50,000 entries scrolls as one of fifty does. Sorting,
// search and selection still see every row; only rendering is windowed.

/** The folder size from which the listing renders a window of its rows. */
export const WINDOW_FROM = 200;

/** Rows rendered past each end of the viewport, so a quick scroll does not show the spacer. */
const OVERSCAN = 16;

/** The rows rendered while the window is not measured yet. */
const FIRST_ROWS = 60;

/** The element that scrolls the listing: the nearest ancestor that scrolls, else the page. */
export const scrollParentOf = (element: HTMLElement | null): HTMLElement => {
  for (let node = element?.parentElement ?? null; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") {
      return node;
    }
  }
  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : document.documentElement;
};

export interface RowWindow<T> {
  /** Put on the element around the table, so the window finds its body and its scroller. */
  wrapperRef: (element: HTMLDivElement | null) => void;
  isWindowed: boolean;
  /** The rows to render: all of them, or the window. */
  rows: readonly T[];
  /** The height, in pixels, of the rows above and below the window that are not rendered. */
  before: number;
  after: number;
}

/**
 * The rows of a listing to render. `estimate` is the height of one row, which the window corrects
 * once a row is on screen.
 */
export const useRowWindow = <T>(all: readonly T[], estimate: number): RowWindow<T> => {
  const isWindowed = all.length >= WINDOW_FROM;
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  // A listing that is not windowed keeps no element in state, so putting it on screen does not
  // render the page again. A new callback once the listing becomes windowed hands the element on.
  const wrapperRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (isWindowed) {
        setWrapper(element);
      }
    },
    [isWindowed],
  );
  const scroller = useMemo(
    () => (isWindowed && wrapper !== null ? scrollParentOf(wrapper) : null),
    [isWindowed, wrapper],
  );
  const [margin, setMargin] = useState(0);
  const [rowHeight, setRowHeight] = useState(estimate);

  useLayoutEffect(() => {
    if (wrapper === null || scroller === null) {
      return undefined;
    }
    const element = scroller;
    const measure = () => {
      const body = wrapper.querySelector("tbody");
      if (body === null || body === undefined) {
        return;
      }
      setMargin(
        Math.round(
          body.getBoundingClientRect().top -
            element.getBoundingClientRect().top +
            element.scrollTop,
        ),
      );
      // At most two spacer rows stand among dozens of real ones, so the median is a real row's.
      const heights = [...body.children]
        .map((row) => (row instanceof HTMLElement ? row.offsetHeight : 0))
        .filter((height) => height > 0)
        .toSorted((a, b) => a - b);
      const height = heights[Math.floor(heights.length / 2)] ?? 0;
      if (height > 0) {
        setRowHeight(height);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [wrapper, scroller]);

  // oxlint-disable-next-line react/incompatible-library -- the window is read in this render and handed on as plain values
  const virtualizer = useVirtualizer({
    count: all.length,
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    scrollMargin: margin,
    enabled: isWindowed,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight]);

  if (!isWindowed) {
    return { wrapperRef, isWindowed, rows: all, before: 0, after: 0 };
  }
  const items = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items.at(-1);
  if (first === undefined || last === undefined) {
    const shown = Math.min(all.length, FIRST_ROWS);
    return {
      wrapperRef,
      isWindowed,
      rows: all.slice(0, shown),
      before: 0,
      after: (all.length - shown) * rowHeight,
    };
  }
  return {
    wrapperRef,
    isWindowed,
    rows: all.slice(first.index, last.index + 1),
    before: Math.max(0, first.start - margin),
    after: Math.max(0, virtualizer.getTotalSize() - (last.end - margin)),
  };
};

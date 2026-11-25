import { useCallback, useState } from "react";
import { useWindowWidth } from "./frame";

/** The root's font size in pixels, which `rem` counts in. */
const remSize = (): number =>
  Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/**
 * The first answer, before the element is measured. An element is never wider than the window, so
 * a window narrower than `rem` answers for it; a wider window is taken to leave the element room.
 * In the prerender the window is the frame being drawn (frame.tsx). A right guess spares the page
 * a second render once the element is measured.
 */
const guess = (rem: number, windowWidth: number): boolean => windowWidth < rem * 16;

/**
 * Whether the element given the returned ref is narrower than `rem`, so a component lays itself out
 * by the room it has rather than by the window. It measures as the element is put on the page,
 * before the browser paints, so the first frame already has the right layout, and again whenever
 * the element changes size. The ref is a callback, so an element that appears later, such as a
 * table after its rows load, is measured too. The element itself is not state: only an answer
 * that changes renders the component again.
 */
export const useNarrowerThan = (rem: number) => {
  const windowWidth = useWindowWidth();
  const [isNarrower, setIsNarrower] = useState(() => guess(rem, windowWidth));
  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (element === null) {
        return undefined;
      }
      const measure = () => setIsNarrower(element.getBoundingClientRect().width < rem * remSize());
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [rem],
  );
  return [ref, isNarrower] as const;
};

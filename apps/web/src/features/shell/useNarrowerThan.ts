import { useCallback, useState } from "react";
import { useWindowWidth } from "./frame";

/** The root's font size in pixels, which `rem` counts in. */
const remSize = (): number =>
  Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/** The width below which AppShell lays a page out as a phone's, in pixels (its md width point). */
const PHONE_LAYOUT_BELOW = 768;

/**
 * The widest a page's content can be in a window `windowWidth` pixels wide: the window less the
 * page's gutters (`usePageGutter`), 16 px on each side on a phone and 24 px beside the side
 * navigation, whatever width the navigation has.
 */
const widestContent = (windowWidth: number): number =>
  windowWidth - 2 * (windowWidth < PHONE_LAYOUT_BELOW ? 16 : 24);

/**
 * The first answer, before the element is measured. An element on the page is never wider than the
 * page's content, so content narrower than `rem` answers for it; wider content is taken to leave
 * the element room. In the prerender the window is the frame being drawn (frame.tsx). A right guess
 * spares the page a second render once the element is measured, which on the page's first render
 * would also run every effect of the page before the browser can paint.
 */
export const guess = (rem: number, windowWidth: number): boolean =>
  widestContent(windowWidth) < rem * 16;

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

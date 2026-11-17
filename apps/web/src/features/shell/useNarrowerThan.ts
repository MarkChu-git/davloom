import { useLayoutEffect, useState } from "react";

/**
 * Whether the element given the returned ref is narrower than `rem`, so a component lays itself out
 * by the room it has rather than by the window. It measures before the browser paints, so the first
 * frame already has the right layout, and again whenever the element changes size. The ref is a
 * callback, so an element that appears later, such as a table after its rows load, is measured too.
 */
export const useNarrowerThan = (rem: number) => {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [isNarrower, setIsNarrower] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      if (element !== null) {
        const remSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
        setIsNarrower(element.getBoundingClientRect().width < rem * remSize);
      }
    };
    const observer = new ResizeObserver(measure);
    if (element !== null) {
      measure();
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [element, rem]);
  return [setElement, isNarrower] as const;
};

import { VStack } from "@astryxdesign/core/Layout";
import * as stylex from "@stylexjs/stylex";
import { createContext, use, type ReactNode } from "react";

/**
 * The windows a Dashboard page's prerendered HTML draws its frame for. The prerender has no window,
 * so it draws the page once for each layout the Dashboard has, and the browser's media queries show
 * the one that fits: a phone below AppShell's md width point (768 px), where a bar across the top
 * takes the side navigation's place; a window up to 1024 px, whose page beside the navigation takes
 * the narrow layouts (`NARROW_PAGE_WIDTH`); and anything wider.
 */
export type FrameWindow = "phone" | "narrow" | "wide";

/** The windows in the order the HTML holds their frames. */
export const FRAME_WINDOWS: readonly FrameWindow[] = ["phone", "narrow", "wide"];

/**
 * The window width each frame is drawn as, in pixels: one inside each range, which the layout
 * decisions taken in script (`useIsNarrowPage`, `useNarrowerThan`) read in place of the window's.
 */
const FRAME_WIDTH: Record<FrameWindow, number> = { phone: 412, narrow: 820, wide: 1280 };

const FrameWindowContext = createContext<FrameWindow>("phone");

/**
 * The window's width: the browser's own, or in the prerender the width of the frame being drawn.
 * A layout guessed from it before anything is measured matches the frame the browser painted.
 */
export const useWindowWidth = (): number => {
  const frame = use(FrameWindowContext);
  return typeof window === "undefined" ? FRAME_WIDTH[frame] : window.innerWidth;
};

const styles = stylex.create({
  phone: {
    display: { default: "contents", "@media (min-width: 768px)": "none" },
  },
  narrow: {
    display: {
      default: "none",
      "@media (min-width: 768px) and (max-width: 1024px)": "contents",
    },
  },
  wide: {
    display: { default: "none", "@media (min-width: 1025px)": "contents" },
  },
});

/**
 * One window's frame in the prerendered HTML: shown only in a window of its range, and drawn with
 * that window's width. The browser renders the page in place of every frame (client.tsx).
 */
export const Frame = ({ layout, children }: { layout: FrameWindow; children: ReactNode }) => (
  <FrameWindowContext value={layout}>
    <VStack xstyle={styles[layout]}>{children}</VStack>
  </FrameWindowContext>
);

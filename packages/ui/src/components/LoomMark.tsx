import { colorVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  mark: {
    display: "block",
    flexShrink: 0,
    inlineSize: 24,
    blockSize: 24,
  },
  tile: {
    fill: colorVars["--color-accent"],
  },
  layer: {
    fill: colorVars["--color-on-accent"],
  },
  // A third of the way from the tile's ink to the core's, then half of what is left, so the
  // three steps between the tile and the core are even.
  outer: {
    fillOpacity: 0.333,
  },
  middle: {
    fillOpacity: 0.5,
  },
});

/**
 * Davloom's mark: four rounded squares, each turned 12 degrees past the one around it and a step
 * lighter, so separate layers twist into one core the way fibres twist into a thread. The steps
 * run from the accent to the ink drawn on it, so the mark inverts with the mode. It is decorative;
 * the product name beside it names the link.
 */
export const LoomMark = () => (
  <svg
    {...stylex.props(styles.mark)}
    viewBox="0 0 32 32"
    aria-hidden="true"
    focusable="false"
    data-testid="loom-mark"
  >
    <rect {...stylex.props(styles.tile)} width="32" height="32" rx="8" />
    <g {...stylex.props(styles.layer)}>
      <rect
        {...stylex.props(styles.outer)}
        x="4.5"
        y="4.5"
        width="23"
        height="23"
        rx="6"
        transform="rotate(12 16 16)"
      />
      <rect
        {...stylex.props(styles.middle)}
        x="8.25"
        y="8.25"
        width="15.5"
        height="15.5"
        rx="4.2"
        transform="rotate(24 16 16)"
      />
      <rect x="11.5" y="11.5" width="9" height="9" rx="2.6" transform="rotate(36 16 16)" />
    </g>
  </svg>
);

import { Icon } from "@astryxdesign/core/Icon";
import { colorVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { SVGProps } from "react";

const styles = stylex.create({
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

/** The mark's artwork. Icon sets its size and hides it from assistive technology. */
const LoomGlyph = (props: Omit<SVGProps<SVGSVGElement>, "ref">) => (
  <svg viewBox="0 0 32 32" {...props}>
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

/**
 * Davloom's mark: a tile and three rounded squares, each turned 12 degrees past the one around it,
 * so separate layers twist into one core the way fibres twist into a thread. Their shades step
 * evenly from the tile's accent to the ink drawn on it, so the mark inverts with the mode. It is
 * decorative; the product name beside it names the link.
 */
export const LoomMark = () => <Icon icon={LoomGlyph} size="lg" />;

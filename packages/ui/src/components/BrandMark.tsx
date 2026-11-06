import { colorVars, radiusVars, spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  mark: {
    display: "inline-flex",
    alignItems: "center",
    paddingBlock: spacingVars["--spacing-1"],
    paddingInline: spacingVars["--spacing-3"],
    borderRadius: radiusVars["--radius-element"],
    backgroundColor: colorVars["--color-accent"],
    color: colorVars["--color-on-accent"],
    fontWeight: 600,
  },
});

/** The product name on the brand color. It is Davloom's own component, styled with StyleX. */
export const BrandMark = () => (
  <span {...stylex.props(styles.mark)} data-testid="brand-mark">
    Davloom
  </span>
);

import { defineTheme, type TokenName, type TokenValue } from "@astryxdesign/core/theme";
import { defineSyntaxTheme } from "@astryxdesign/core/theme/syntax";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { brandTokens } from "../tokens/brand";
import {
  HUES,
  STATUSES,
  elevationShadows,
  hueTone,
  insetRings,
  invertedTones,
  layerTones,
  statusShared,
  statusTones,
  syntaxTones,
  trackTone,
} from "../tokens/monochrome";

const pair = ([light, dark]: readonly [string, string]): [string, string] => [light, dark];

const tokens: Partial<Record<TokenName, TokenValue>> = {
  "--color-accent": pair(brandTokens.accent),
  "--color-accent-muted": pair(brandTokens.accentMuted),
  "--color-on-accent": pair(brandTokens.onAccent),
  "--color-text-accent": pair(brandTokens.textAccent),
  "--color-background-body": pair(layerTones.body),
  "--color-background-surface": pair(layerTones.surface),
  "--color-background-card": pair(layerTones.card),
  "--color-background-popover": pair(layerTones.popover),
  "--color-background-inverted": pair(invertedTones.background),
  "--color-background-error-inverted": pair(invertedTones.errorBackground),
  "--color-track": pair(trackTone),
  "--shadow-low": elevationShadows.low,
  "--shadow-med": elevationShadows.med,
  "--shadow-high": elevationShadows.high,
  "--shadow-inset-hover": insetRings.hover,
  "--shadow-inset-selected": insetRings.selected,
  "--shadow-inset-success": insetRings.success,
  "--shadow-inset-warning": insetRings.warning,
  "--shadow-inset-error": insetRings.error,
};

for (const status of STATUSES) {
  tokens[`--color-${status}` as const] = pair(statusTones[status].fill);
  tokens[`--color-text-${status}` as const] = pair(statusTones[status].text);
  tokens[`--color-on-${status}` as const] = pair(statusShared.onFill);
  tokens[`--color-${status}-muted` as const] = pair(statusShared.muted);
  tokens[`--color-on-${status}-muted` as const] = pair(statusShared.onMuted);
}

for (const hue of HUES) {
  tokens[`--color-background-${hue}` as const] = pair(hueTone.background);
  tokens[`--color-border-${hue}` as const] = pair(hueTone.border);
  tokens[`--color-icon-${hue}` as const] = pair(hueTone.icon);
  tokens[`--color-text-${hue}` as const] = pair(hueTone.text);
}

/** Davloom Theme: the neutral theme in black, white and grays (see ../tokens/monochrome). */
export const davloomTheme = defineTheme({
  name: "davloom",
  extends: neutralTheme,
  tokens,
  localTokens: {
    "--astryx-theme-neutral-color-status-fill-accent": pair(brandTokens.accent),
  },
  components: {
    // Cards rest just above the page, so they read as a layer of their own. A card given an
    // elevation keeps that elevation's shadow.
    card: {
      "elevation:none": {
        boxShadow: "var(--shadow-low)",
      },
    },
    // A hairline where the side navigation meets the page. Narrow windows show the navigation as
    // a top bar and a drawer, where the page does not sit beside it.
    "side-nav": {
      base: {
        borderInlineEndWidth: "1px",
        borderInlineEndStyle: "solid",
        borderInlineEndColor: "var(--color-border)",
      },
      "mode:topbar": { borderInlineEndWidth: "0" },
      "mode:drawer": { borderInlineEndWidth: "0" },
      "mode:drawer-content": { borderInlineEndWidth: "0" },
    },
    // Rows in medium weight recede to secondary text, as in Linear. The current page keeps the
    // design system's fill and primary text and turns semibold, so it differs in weight as well as
    // shade (WCAG 1.4.1); its icon also draws a heavier stroke.
    "side-nav-item": {
      base: {
        "--color-text-primary": "var(--color-text-secondary)",
        fontWeight: "var(--font-weight-medium)",
      },
      selected: {
        "--color-text-primary": "inherit",
        fontWeight: "var(--font-weight-semibold)",
      },
    },
  },
  syntax: defineSyntaxTheme({
    name: "davloom-mono",
    tokens: {
      keyword: pair(syntaxTones.keyword),
      type: pair(syntaxTones.type),
      tag: pair(syntaxTones.tag),
      variable: pair(syntaxTones.variable),
      function: pair(syntaxTones.function),
      string: pair(syntaxTones.string),
      number: pair(syntaxTones.number),
      constant: pair(syntaxTones.constant),
      attribute: pair(syntaxTones.attribute),
      property: pair(syntaxTones.property),
      comment: pair(syntaxTones.comment),
      operator: pair(syntaxTones.operator),
      punctuation: pair(syntaxTones.punctuation),
      background: pair(syntaxTones.background),
    },
  }),
});

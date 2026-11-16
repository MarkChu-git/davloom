import { defineTheme, type TokenName, type TokenValue } from "@astryxdesign/core/theme";
import { defineSyntaxTheme } from "@astryxdesign/core/theme/syntax";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { brandTokens } from "../tokens/brand";
import {
  HUES,
  STATUSES,
  hueTone,
  insetRings,
  invertedTones,
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
  "--color-background-inverted": pair(invertedTones.background),
  "--color-background-error-inverted": pair(invertedTones.errorBackground),
  "--color-track": pair(trackTone),
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

import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { brandTokens } from "../tokens/brand";

const pair = ([light, dark]: readonly [string, string]): [string, string] => [light, dark];

/** Davloom Theme: the neutral theme with Davloom's brand colors. */
export const davloomTheme = defineTheme({
  name: "davloom",
  extends: neutralTheme,
  tokens: {
    "--color-accent": pair(brandTokens.accent),
    "--color-accent-muted": pair(brandTokens.accentMuted),
    "--color-on-accent": pair(brandTokens.onAccent),
    "--color-text-accent": pair(brandTokens.textAccent),
  },
});

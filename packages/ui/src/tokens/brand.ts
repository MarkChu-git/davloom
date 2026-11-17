/**
 * Davloom's brand colors as [light, dark] pairs. The theme is built from these values.
 *
 * Davloom is black, white and grays, with hues only for statuses: the accent is near-black ink in
 * light mode and near-white ink in dark mode, so the primary action is the strongest contrast on
 * the page.
 */
export const brandTokens = {
  accent: ["#111111", "#f1f1f1"],
  accentMuted: ["#e2e2e2", "#303030"],
  onAccent: ["#ffffff", "#111111"],
  textAccent: ["#111111", "#f1f1f1"],
} as const satisfies Record<string, readonly [light: string, dark: string]>;

/** Davloom's brand colors as [light, dark] pairs. The theme is built from these values. */
export const brandTokens = {
  accent: ["#0b6e6e", "#5fd4cf"],
  accentMuted: ["#d7efee", "#123b3b"],
  onAccent: ["#ffffff", "#062424"],
  textAccent: ["#0b6e6e", "#5fd4cf"],
} as const satisfies Record<string, readonly [light: string, dark: string]>;

import { brandTokens } from "@davloom/ui/tokens/brand";
import type { Locator } from "@playwright/test";

/** The browser reports computed colors as rgb(), and the tokens are written as hex. */
export const rgb = (hex: string): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 0xff}, ${value & 0xff})`;
};

export const backgroundOf = (element: Locator): Promise<string> =>
  element.evaluate((node) => getComputedStyle(node).backgroundColor);

export const BRAND_LIGHT = rgb(process.env.DAVLOOM_EXPECTED_BRAND_LIGHT ?? brandTokens.accent[0]);
export const BRAND_DARK = rgb(brandTokens.accent[1]);

import { resolveThemeToken } from "@astryxdesign/core/theme";
import { describe, expect, it } from "vitest";
import { STATUSES } from "../tokens/monochrome";
import { davloomTheme } from "./davloom.js";

type Mode = "light" | "dark";

const token = (name: string, mode: Mode): string => resolveThemeToken(davloomTheme, name, { mode });

// The WCAG 2 relative luminance of an opaque #rrggbb color.
const luminance = (hex: string): number => {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (one: string, other: string): number => {
  const [lighter = 0, darker = 0] = [luminance(one), luminance(other)].toSorted((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

describe("status colors", () => {
  it.each(["light", "dark"] as const)(
    "Status contrast: in %s mode status text and the text on status fills reach 4.5:1",
    (mode) => {
      // The grays that status text sits on: the frame, the page, cards and popovers.
      const backgrounds = ["body", "surface", "card", "popover"].map((name) =>
        token(`--color-background-${name}`, mode),
      );
      for (const background of backgrounds) {
        expect(background, "a background is a gray in #rrggbb notation").toMatch(
          /^#([\da-f]{2})\1\1$/i,
        );
      }
      for (const status of STATUSES) {
        const text = token(`--color-text-${status}`, mode);
        const fill = token(`--color-${status}`, mode);
        const onFill = token(`--color-on-${status}`, mode);
        for (const color of [text, fill, onFill]) {
          expect(color, `a ${status} color is an opaque #rrggbb`).toMatch(/^#[\da-f]{6}$/i);
        }
        for (const background of backgrounds) {
          expect(
            contrast(text, background),
            `${status} text on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(onFill, fill), `text on the ${status} fill`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

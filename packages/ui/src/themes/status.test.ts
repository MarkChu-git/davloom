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

// A #rrggbb or #rrggbbaa fill laid over an opaque #rrggbb background, as the browser blends it.
const over = (fill: string, background: string): string => {
  const alpha = fill.length === 9 ? Number.parseInt(fill.slice(7, 9), 16) / 255 : 1;
  const channels = [1, 3, 5].map((at) => {
    const top = Number.parseInt(fill.slice(at, at + 2), 16);
    const bottom = Number.parseInt(background.slice(at, at + 2), 16);
    return Math.round(top * alpha + bottom * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
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

        // A muted fill, as a destructive button and a banner draw it, may let the background show
        // through, so its text is measured on the blend over each background.
        const muted = token(`--color-${status}-muted`, mode);
        const onMuted = token(`--color-on-${status}-muted`, mode);
        expect(muted, `the ${status} muted fill is #rrggbb or #rrggbbaa`).toMatch(
          /^#[\da-f]{6}(?:[\da-f]{2})?$/i,
        );
        expect(onMuted, `the text on the ${status} muted fill is an opaque #rrggbb`).toMatch(
          /^#[\da-f]{6}$/i,
        );
        for (const background of backgrounds) {
          expect(
            contrast(onMuted, over(muted, background)),
            `text on the ${status} muted fill over ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );
});

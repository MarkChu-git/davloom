import { resolveThemeToken } from "@astryxdesign/core/theme";
import { describe, expect, it } from "vitest";
import { davloomTheme } from "../themes/davloom.js";
import { STATUSES, insetRings, statusTones, type Status } from "./monochrome";

// The grays that statuses and rings sit on, from the built theme: its body, card, surface and
// popover backgrounds in each mode.
const backgroundsIn = (mode: "light" | "dark"): string[] =>
  ["body", "card", "surface", "popover"].map((name) =>
    resolveThemeToken(davloomTheme, `--color-background-${name}`, { mode }),
  );

// How far a gray stands from the background behind it, once its alpha, if it has one, lets the
// background show through.
const strength = (hex: string, background: string): number => {
  const level = Number.parseInt(hex.slice(1, 3), 16);
  const behind = Number.parseInt(background.slice(1, 3), 16);
  const alpha = hex.length === 9 ? Number.parseInt(hex.slice(7, 9), 16) / 255 : 1;
  return Math.abs(level * alpha + behind * (1 - alpha) - behind);
};

// The gray and alpha a ring draws in each mode, from its light-dark(#rrggbbaa, #rrggbbaa).
const ringGray = (status: "error" | "warning" | "success", index: number): string =>
  insetRings[status].match(/#[\da-f]{8}/gi)?.[index] ?? "";

describe("status ranking", () => {
  it.each([
    ["light", 0],
    ["dark", 1],
  ] as const)(
    "Status ranking: in %s mode errors stand out most, then warnings, then success and information",
    (mode, index) => {
      for (const background of backgroundsIn(mode)) {
        expect(background, "a background is a gray in #rrggbb notation").toMatch(
          /^#([\da-f]{2})\1\1$/i,
        );
        const ranks = (gray: (status: Status) => string) => {
          const [error = 0, warning = 0, success = 0, info = 0] = STATUSES.map((status) =>
            strength(gray(status), background),
          );
          expect(error).toBeGreaterThan(warning);
          expect(warning).toBeGreaterThan(success);
          expect(info).toBe(success);
        };
        ranks((status) => statusTones[status].fill[index]);
        ranks((status) => statusTones[status].text[index]);
        // Rings mark errors, warnings and success; information has none of its own.
        const [error = 0, warning = 0, success = 0] = (
          ["error", "warning", "success"] as const
        ).map((status) => strength(ringGray(status, index), background));
        expect(error).toBeGreaterThan(warning);
        expect(warning).toBeGreaterThan(success);
      }
    },
  );
});

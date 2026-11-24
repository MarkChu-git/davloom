import { resolveThemeToken } from "@astryxdesign/core/theme";
import { describe, expect, it } from "vitest";
import { brandTokens } from "../tokens/brand";
import { HUES, hueTone, layerTones } from "../tokens/monochrome";
import { davloomTheme as built } from "./davloom.js";
import { davloomTheme as source } from "./davloom-source";

const MODES = [
  ["light", 0],
  ["dark", 1],
] as const;

type Row = [name: string, mode: (typeof MODES)[number][0], value: string];

// The source the build reads, checked on its own: what it maps, and that the built theme agrees.
describe("the theme source", () => {
  it("extends the neutral theme under Davloom's name", () => {
    expect(source.name).toBe("davloom");
    expect(built.name).toBe(source.name);
  });

  it.each(
    MODES.flatMap(([mode, at]): Row[] => [
      ["--color-accent", mode, brandTokens.accent[at]],
      ["--color-accent-muted", mode, brandTokens.accentMuted[at]],
      ["--color-on-accent", mode, brandTokens.onAccent[at]],
      ["--color-text-accent", mode, brandTokens.textAccent[at]],
      ["--color-background-body", mode, layerTones.body[at]],
      ["--color-background-card", mode, layerTones.card[at]],
    ]),
  )("maps %s in %s mode to %s", (name, mode, value) => {
    expect(resolveThemeToken(source, name, { mode })).toBe(value);
  });

  it.each(
    MODES.flatMap(([mode, at]) =>
      HUES.flatMap((hue): Row[] => [
        [`--color-background-${hue}`, mode, hueTone.background[at]],
        [`--color-text-${hue}`, mode, hueTone.text[at]],
      ]),
    ),
  )("turns the hue %s in %s mode gray: %s", (name, mode, value) => {
    expect(resolveThemeToken(source, name, { mode })).toBe(value);
  });

  it.each(
    MODES.flatMap(([mode]) =>
      [
        "--color-accent",
        "--color-on-accent",
        "--color-background-surface",
        "--color-background-popover",
        "--color-track",
        "--shadow-low",
        "--shadow-high",
        `--color-border-${HUES[0]}`,
        `--color-icon-${HUES[0]}`,
      ].map((name) => [name, mode] as const),
    ),
  )("builds %s in %s mode as the source has it", (name, mode) => {
    expect(resolveThemeToken(built, name, { mode })).toBe(
      resolveThemeToken(source, name, { mode }),
    );
  });

  it("gives every brand token a light and a dark value", () => {
    for (const [light, dark] of Object.values(brandTokens)) {
      expect(light).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(light).not.toBe(dark);
    }
  });
});

import { describe, expect, it } from "vitest";
import { STATUSES } from "../tokens/monochrome";
import { davloomTheme } from "./davloom.js";

// The stylesheet as browsers load it. Bun's fetch reads file URLs; Vitest would load CSS empty.
const stylesheet = await (await fetch(new URL("davloom.css", import.meta.url))).text();

// Every string in the built theme, apart from its icons, with the path that leads to it.
const stringsIn = (value: unknown, path: string): [path: string, value: string][] => {
  if (typeof value === "string") {
    return [[path, value]];
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    key === "icons" ? [] : stringsIn(child, `${path}.${key}`),
  );
};

// The value of every declaration in a stylesheet, without comments and selectors. A ; inside
// quotes or parentheses, as in a data URL, does not end the value, and neither does a quote
// escaped with a backslash.
const declarationsIn = (css: string): [property: string, value: string][] => {
  const text = css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const found: [string, string][] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] ?? "";
    if (quote !== "") {
      if (char === "\\") {
        at += 1;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (depth === 0 && (char === ";" || char === "{" || char === "}")) {
      // A selector comes before {, and a declaration before ; or }.
      const declaration = /^\s*(-{0,2}[\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(text.slice(start, at));
      if (char !== "{" && declaration !== null) {
        found.push([declaration[1] ?? "", declaration[2] ?? ""]);
      }
      start = at + 1;
    }
  }
  return found;
};

// A data URL may percent-encode what it holds, such as # as %23, or hold it in base64.
const unescaped = (value: string): string =>
  value
    .replaceAll(/%([\da-f]{2})/gi, (_escape, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replaceAll(/;base64,([\d+/=a-z]+)/gi, (_encoded, payload: string) => {
      try {
        return `;base64,${atob(payload)}`;
      } catch (error) {
        // A payload the check cannot read could hide a hue, so the check fails instead.
        throw new Error(`The hue check cannot decode the base64 payload ${payload}.`, {
          cause: error,
        });
      }
    });

const HEX = /#([0-9a-f]{3,8})\b/gi;
const RGB =
  /rgba?\(\s*([\d.]+(?:e[+-]?\d+)?%?)[\s,]+([\d.]+(?:e[+-]?\d+)?%?)[\s,]+([\d.]+(?:e[+-]?\d+)?%?)/gi;
const HSL = /hsla?\(\s*[\d.]+(?:e[+-]?\d+)?(?:deg|g?rad|turn)?[\s,]+([\d.]+(?:e[+-]?\d+)?)%?/gi;
const HWB =
  /hwb\(\s*[\d.]+(?:e[+-]?\d+)?(?:deg|g?rad|turn)?\s+([\d.]+(?:e[+-]?\d+)?)%\s+([\d.]+(?:e[+-]?\d+)?)%/gi;
const LCH = /(?:ok)?lch\(\s*[\d.]+(?:e[+-]?\d+)?%?\s+([\d.]+(?:e[+-]?\d+)?)%?/gi;
const LAB =
  /(?:ok)?lab\(\s*[\d.]+(?:e[+-]?\d+)?%?\s+(-?[\d.]+(?:e[+-]?\d+)?)%?\s+(-?[\d.]+(?:e[+-]?\d+)?)%?/gi;
const UNCHECKED = /\bcolor\(/gi;
// Every call of a color function the patterns above read, whether or not one of them could.
const FUNCTION = /\b(?:rgba?|hsla?|hwb|(?:ok)?lab|(?:ok)?lch)\(/gi;

// CSS named colors other than black, white and the grays, and the system colors with a hue.
const HUED_NAMES = `
  aliceblue antiquewhite aqua aquamarine azure beige bisque blanchedalmond blue blueviolet
  brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan
  darkblue darkcyan darkgoldenrod darkgreen darkkhaki darkmagenta darkolivegreen darkorange
  darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
  darkturquoise darkviolet deeppink deepskyblue dodgerblue firebrick floralwhite forestgreen
  fuchsia ghostwhite gold goldenrod green greenyellow honeydew hotpink indianred indigo ivory
  khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgreen lightpink lightsalmon lightseagreen lightskyblue
  lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon
  mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
  mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
  navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
  paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
  rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna
  skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato
  turquoise violet wheat yellow yellowgreen accentcolor accentcolortext activetext highlight
  highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext
`
  .trim()
  .split(/\s+/);
// A whole name: "--color-background-red" or "brand-mark" is not one.
const NAMED = new RegExp(`(?<![\\w-])(?:${HUED_NAMES.join("|")})(?![\\w-])`, "gi");

const channel = (value: string): number =>
  value.endsWith("%") ? Math.round(Number(value.slice(0, -1)) * 2.55) : Number(value);

const isGrayHex = (digits: string): boolean => {
  const full = digits.length <= 4 ? digits.replaceAll(/./g, "$&$&") : digits;
  const [red, green, blue] = [0, 2, 4].map((at) => full.slice(at, at + 2).toLowerCase());
  return red === green && green === blue;
};

// Where the patterns for color functions found a call they could read.
const readAt = (value: string): Set<number> =>
  new Set(
    [RGB, HSL, HWB, LCH, LAB].flatMap((pattern) =>
      [...value.matchAll(pattern)].map(({ index }) => index),
    ),
  );

// The color literals in a CSS value that are not black, white or a gray. A color function this
// does not parse, such as color() or hsl(none 100% 50%), counts as a hue, so a new notation fails
// the test instead of slipping past.
const huesIn = (raw: string): string[] => {
  const value = unescaped(raw);
  return [
    ...[...value.matchAll(HEX)].filter(([, digits = ""]) => !isGrayHex(digits)).map(([hex]) => hex),
    ...[...value.matchAll(RGB)]
      .filter(([, red = "", green = "", blue = ""]) => {
        const [r, g, b] = [red, green, blue].map(channel);
        return !(r === g && g === b);
      })
      .map(([rgb]) => rgb),
    ...[...value.matchAll(HSL)]
      .filter(([, saturation]) => Number(saturation) !== 0)
      .map(([hsl]) => hsl),
    ...[...value.matchAll(HWB)]
      .filter(([, white, black]) => Number(white) + Number(black) < 100)
      .map(([hwb]) => hwb),
    ...[...value.matchAll(LCH)].filter(([, chroma]) => Number(chroma) !== 0).map(([lch]) => lch),
    ...[...value.matchAll(LAB)]
      .filter(([, a, b]) => Number(a) !== 0 || Number(b) !== 0)
      .map(([lab]) => lab),
    ...[...value.matchAll(UNCHECKED)].map(([name]) => name),
    ...[...value.matchAll(FUNCTION)]
      .filter(({ index }) => !readAt(value).has(index))
      .map(([call]) => call),
    ...[...value.matchAll(NAMED)].map(([name]) => name),
  ];
};

const colorsIn = (value: string): number =>
  [HEX, RGB, HSL, HWB, LCH, LAB].reduce(
    (count, pattern) => count + [...value.matchAll(pattern)].length,
    0,
  );

describe("the hue check", () => {
  it.each([
    ["#e3193b", ["#e3193b"]],
    ["light-dark(#111111, #F1F1F1)", []],
    ["#abc", ["#abc"]],
    ["#7778", []],
    ["rgb(17 17 17)", []],
    ["rgba(0, 0, 255, 0.5)", ["rgba(0, 0, 255"]],
    ["rgb(100% 0% 0%)", ["rgb(100% 0% 0%"]],
    ["rgb(50% 50% 50%)", []],
    ["hsl(210deg 40% 50%)", ["hsl(210deg 40%"]],
    ["hsl(0.5turn 40% 50%)", ["hsl(0.5turn 40%"]],
    ["hsl(0 0% 50%)", []],
    ["hwb(0 0% 0%)", ["hwb(0 0% 0%"]],
    ["hwb(0 60% 40%)", []],
    ["oklch(0 0 0 / 0.1)", []],
    ["oklch(0.63 0.2 25)", ["oklch(0.63 0.2"]],
    ["lab(50 20 -30)", ["lab(50 20 -30"]],
    ["oklab(0.5 0 0)", []],
    ["color(display-p3 1 0 0)", ["color("]],
    ["hsl(-30 100% 50%)", ["hsl("]],
    ["hsl(none 100% 50%)", ["hsl("]],
    ["rgb(calc(255) 0 0)", ["rgb("]],
    ["color-mix(in srgb, red 40%, white)", ["red"]],
    ["AccentColor", ["AccentColor"]],
    ["var(--color-background-red)", []],
    ["Canvas", []],
    ["rgb(1 1 1e2)", ["rgb(1 1 1e2"]],
    ["%23e3193b", ["#e3193b"]],
    ["hsl(0 0% 50%) %2523", []],
    ["url(data:image/svg+xml;base64,PHN2ZyBmaWxsPScjZTMxOTNiJy8+)", ["#e3193b"]],
    ["url(data:image/svg+xml;base64,PHN2ZyBmaWxsPScjMTExMTExJy8+)", []],
  ])("reads %s as %j", (value, hues) => {
    expect(huesIn(value)).toEqual(hues);
  });

  it("fails on a base64 payload it cannot decode", () => {
    expect(() => huesIn("url(data:image/svg+xml;base64,PHN2Z)")).toThrow("cannot decode");
  });

  it("reads each declaration whole, even with a ; inside quotes or parentheses or after an escaped quote", () => {
    const svg = `url("data:image/svg+xml;utf8,<svg fill='%23e3193b'/>")`;
    const quoted = String.raw`"a\";b"`;
    const declarations = declarationsIn(
      `:root:not([data-theme="light"]) { --a: ${svg}; --b: light-dark(#111, #eee); --c: ${quoted}; --d: #222 }`,
    );
    expect(declarations).toEqual([
      ["--a", svg],
      ["--b", "light-dark(#111, #eee)"],
      ["--c", quoted],
      ["--d", "#222"],
    ]);
    expect(huesIn(svg)).toEqual(["#e3193b"]);
  });
});

// The tokens that may hold a hue: each status's fill, its text and border, its muted background
// and the text on that, and its ring. Everything else in the theme is black, white or a gray.
const STATUS_TOKEN =
  /^--(?:color-(?:(?:text|on|border)-)?(?:error|warning|success|info)(?:-muted)?|shadow-inset-(?:error|warning|success|info))$/;

const lastKey = (path: string): string => path.slice(path.lastIndexOf(".") + 1);

describe("Gray and white, with color for status", () => {
  const values = stringsIn(davloomTheme, "davloomTheme");
  const declarations = declarationsIn(stylesheet);

  it("The theme stylesheet: every hue in the built stylesheet belongs to a status token", () => {
    expect(
      declarations
        .filter(([property]) => !STATUS_TOKEN.test(property))
        .flatMap(([property, value]) => huesIn(value).map((hue) => `${property}: ${hue}`)),
    ).toEqual([]);
  });

  it("The theme stylesheet: every hue in the built theme module belongs to a status token", () => {
    expect(
      values
        .filter(([path]) => !STATUS_TOKEN.test(lastKey(path)))
        .flatMap(([path, value]) => huesIn(value).map((hue) => `${path}: ${hue}`)),
    ).toEqual([]);
  });

  it("The theme stylesheet: each status keeps a hue in its fill and its text", () => {
    for (const status of STATUSES) {
      for (const token of [`--color-${status}`, `--color-text-${status}`]) {
        const hues = declarations
          .filter(([property]) => property === token)
          .flatMap(([, value]) => huesIn(value));
        expect(hues, token).not.toEqual([]);
      }
    }
  });

  it("reads enough colors to mean something", () => {
    // The accent, the four statuses, the nine categorical hues and the syntax tokens alone set
    // well over a hundred colors, so a much lower count means the theme's shape has changed.
    expect(values.reduce((count, [, value]) => count + colorsIn(value), 0)).toBeGreaterThan(100);
    expect(declarations.reduce((count, [, value]) => count + colorsIn(value), 0)).toBeGreaterThan(
      100,
    );
  });
});

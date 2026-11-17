/**
 * Davloom is drawn in black, white and grays, as [light, dark] pairs. Only statuses take a hue,
 * and they keep the neutral theme's colors, so this module leaves them out. The categorical
 * palette and the syntax colors map onto grays here, because no page needs them in color.
 */
type Pair = readonly [light: string, dark: string];

/** The four statuses, whose colors come from the neutral theme. */
export const STATUSES = ["error", "warning", "success", "info"] as const;

export type Status = (typeof STATUSES)[number];

/** Surfaces drawn in reverse, such as toasts. An error toast keeps the theme's red. */
export const invertedTones = {
  background: ["#111111", "#f1f1f1"],
} as const satisfies Record<string, Pair>;

/**
 * The layers a page is built from, from the bottom up: the frame with the side navigation, the
 * page, the cards on it, and the popovers above them. Each layer is lighter than the one below,
 * and the shadows below lift it further.
 */
export const layerTones = {
  body: ["#f1f1f1", "#121212"],
  surface: ["#fcfcfc", "#171717"],
  card: ["#ffffff", "#1e1e1e"],
  popover: ["#ffffff", "#262626"],
} as const satisfies Record<string, Pair>;

/**
 * In dark mode a shadow barely shows against a dark page, so each raised layer also draws a
 * white hairline just inside its edge, as the neutral theme does.
 */
const darkEdge = (opacity: string) =>
  `inset 0px 0px 0px 1px light-dark(transparent, #ffffff${opacity})`;

/** The shadows under cards, menus and dialogs, in black at low opacity. */
export const elevationShadows = {
  low: `0px 1px 2px light-dark(#0000000f, #0000004d), ${darkEdge("14")}`,
  med: `0px 1px 2px light-dark(#0000000f, #0000004d), 0px 4px 12px light-dark(#00000014, #00000066), ${darkEdge("1f")}`,
  high: `0px 2px 4px light-dark(#00000014, #0000004d), 0px 12px 32px light-dark(#0000001f, #00000080), ${darkEdge("26")}`,
} as const;

/** The empty part of tracks, such as a progress bar's. */
export const trackTone = ["#d4d4d4", "#525252"] as const satisfies Pair;

export const HUES = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "cyan",
  "blue",
  "purple",
  "pink",
] as const;

/** Each hue of the categorical palette takes the values of the palette's own gray. */
export const hueTone = {
  background: ["#e2e2e2", "#303030"],
  border: ["#d4d4d4", "#262626"],
  icon: ["#474747", "#9e9e9e"],
  text: ["#1b1b1b", "#d4d4d4"],
} as const satisfies Record<string, Pair>;

/** Code is told apart by how dark its ink is: keywords darkest, comments and punctuation lightest. */
export const syntaxTones = {
  keyword: ["#000000", "#ffffff"],
  type: ["#000000", "#ffffff"],
  tag: ["#000000", "#ffffff"],
  variable: ["#111111", "#e2e2e2"],
  function: ["#262626", "#e2e2e2"],
  string: ["#474747", "#c6c6c6"],
  number: ["#474747", "#c6c6c6"],
  constant: ["#474747", "#c6c6c6"],
  attribute: ["#474747", "#c6c6c6"],
  property: ["#474747", "#c6c6c6"],
  comment: ["#6a6a6a", "#9e9e9e"],
  operator: ["#6a6a6a", "#9e9e9e"],
  punctuation: ["#6a6a6a", "#9e9e9e"],
  background: ["#ffffff", "#111111"],
} as const satisfies Record<string, Pair>;

/** The rings drawn inside hovered and selected elements. Status rings keep their colors. */
export const insetRings = {
  hover: "inset 0px 0px 0px 2px light-dark(#0000004d, #ffffff4d)",
  selected: "inset 0px 0px 0px 2px light-dark(#00000080, #ffffff80)",
} as const;

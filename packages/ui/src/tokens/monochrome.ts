/**
 * Davloom has no hues. The design system's status colors, its categorical palette and its syntax
 * colors all map onto grays here, as [light, dark] pairs. A state reads from its icon and words,
 * never from color alone; the shade only sets how loud it is, and an error is the loudest.
 */
type Pair = readonly [light: string, dark: string];

export const STATUSES = ["error", "warning", "success", "info"] as const;

export type Status = (typeof STATUSES)[number];

/** `fill` sits behind `onFill` text, as in a solid badge; `text` is status text on a surface. */
export const statusTones = {
  error: { fill: ["#111111", "#f1f1f1"], text: ["#000000", "#ffffff"] },
  warning: { fill: ["#474747", "#c6c6c6"], text: ["#303030", "#d4d4d4"] },
  success: { fill: ["#6a6a6a", "#9e9e9e"], text: ["#474747", "#9e9e9e"] },
  info: { fill: ["#6a6a6a", "#9e9e9e"], text: ["#474747", "#9e9e9e"] },
} as const satisfies Record<Status, { fill: Pair; text: Pair }>;

/** Surfaces drawn in reverse, such as toasts. An error toast takes the deepest ink. */
export const invertedTones = {
  background: ["#111111", "#f1f1f1"],
  errorBackground: ["#000000", "#ffffff"],
} as const satisfies Record<string, Pair>;

/** The empty part of tracks, such as a progress bar's. */
export const trackTone = ["#d4d4d4", "#525252"] as const satisfies Pair;

/** Every status shares its text-on-fill color and its subtle background. */
export const statusShared = {
  onFill: ["#ffffff", "#111111"],
  muted: ["#e2e2e2", "#303030"],
  onMuted: ["#111111", "#f1f1f1"],
} as const satisfies Record<string, Pair>;

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

/** The rings drawn inside hovered, selected and status-marked elements. */
export const insetRings = {
  hover: "inset 0px 0px 0px 2px light-dark(#0000004d, #ffffff4d)",
  selected: "inset 0px 0px 0px 2px light-dark(#00000080, #ffffff80)",
  success: "inset 0px 0px 0px 2px light-dark(#6a6a6a4d, #9e9e9e4d)",
  warning: "inset 0px 0px 0px 2px light-dark(#4747474d, #c6c6c64d)",
  error: "inset 0px 0px 0px 2px light-dark(#1111114d, #f1f1f14d)",
} as const;

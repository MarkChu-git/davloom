import { CircleX, CopyX, Lock, Maximize2, TimerOff, type LucideIconData } from "@lucide/icons";
import {
  Copy,
  createLucideIcon,
  File,
  FolderInput,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { SAMPLE_NOW, type OperationError } from "../sample-data/data";

/** Why an operation failed, as a picture and in a word or two. */
export interface Cause {
  /** The cause in words, such as "Timed out". */
  label: string;
  /** The picture as Lucide's icon data, which the errors timeline draws as paths. */
  glyph: LucideIconData;
  /** The same picture as a component, for Astryx Icon. */
  icon: LucideIcon;
}

const cause = (label: string, glyph: LucideIconData): Cause => ({
  label,
  glyph,
  icon: createLucideIcon(glyph),
});

// The status codes the sample operations fail with, each named for what the owner of the instance
// would do about it. A MOVE or COPY with `Overwrite: F` onto a name that exists fails with 412.
const CAUSES: ReadonlyMap<number, Cause> = new Map([
  [412, cause("Already exists", CopyX)],
  [413, cause("Too large", Maximize2)],
  [423, cause("Locked", Lock)],
  [504, cause("Timed out", TimerOff)],
]);

const FAILED = cause("Failed", CircleX);

export const causeOf = (error: OperationError): Cause => CAUSES.get(error.status) ?? FAILED;

const METHOD_ICONS: ReadonlyMap<string, LucideIcon> = new Map([
  ["COPY", Copy],
  ["DELETE", Trash2],
  ["MOVE", FolderInput],
  ["PUT", Upload],
]);

/** A picture of an operation's method, such as an upload arrow for PUT. */
export const methodIconOf = (error: OperationError): LucideIcon =>
  METHOD_ICONS.get(error.method) ?? File;

/** The name of the file or folder an operation failed on: the last part of its source path. */
export const nameOf = (error: OperationError): string => {
  const [source = error.path] = error.path.split(" → ");
  return source.split("/").findLast((part) => part !== "") ?? source;
};

/** Whole minutes between an operation and the sample clock. */
export const minutesAgo = (iso: string): number =>
  Math.max(0, Math.round((SAMPLE_NOW.getTime() - new Date(iso).getTime()) / 60_000));

const inUnit = (unit: "minute" | "hour" | "day") =>
  new Intl.NumberFormat("en", { style: "unit", unit, unitDisplay: "narrow" });
const inMinutes = inUnit("minute");
const inHours = inUnit("hour");
const inDays = inUnit("day");

/**
 * A span of minutes as short as it gets, such as "12m", "5h" or "2d". It rounds as the sentences
 * of `formatRelative` do, so "2h" and "2 hours ago" name the same age.
 */
export const shortSpan = (minutes: number): string => {
  if (minutes < 60) {
    return inMinutes.format(Math.round(minutes));
  }
  if (minutes < 24 * 60) {
    return inHours.format(Math.round(minutes / 60));
  }
  return inDays.format(Math.round(minutes / (24 * 60)));
};

const numberIn = (attributes: Readonly<Record<string, unknown>>, name: string): number =>
  Number(attributes[name] ?? 0);

/** An attribute that SVG writes as text, such as a path's data, or "" where it has none. */
const textIn = (attributes: Readonly<Record<string, unknown>>, name: string): string => {
  const value = attributes[name];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

/** A polyline's or polygon's points as path data: "M x y" first, then "L x y" for each. */
const pointsPath = (attributes: Readonly<Record<string, unknown>>): string => {
  const values = textIn(attributes, "points")
    .trim()
    .split(/[\s,]+/);
  const pairs: string[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    pairs.push(`${index === 0 ? "M" : "L"}${values[index]} ${values[index + 1]}`);
  }
  return pairs.join("");
};

/**
 * Each shape of a Lucide icon as SVG path data, in the icon's own 24 by 24 box, so that a chart
 * that draws paths can draw the icon. Lucide draws with paths, lines, circles, ellipses,
 * rectangles, polylines and polygons.
 */
export const glyphPaths = (glyph: LucideIconData): string[] =>
  glyph.node.flatMap(([name, attributes]): string[] => {
    const a: Readonly<Record<string, unknown>> = attributes;
    switch (name) {
      case "path":
        return [textIn(a, "d")];
      case "line":
        return [
          `M${numberIn(a, "x1")} ${numberIn(a, "y1")}L${numberIn(a, "x2")} ${numberIn(a, "y2")}`,
        ];
      case "circle":
      case "ellipse": {
        const cx = numberIn(a, "cx");
        const cy = numberIn(a, "cy");
        const rx = numberIn(a, name === "circle" ? "r" : "rx");
        const ry = numberIn(a, name === "circle" ? "r" : "ry");
        return [`M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`];
      }
      case "rect": {
        const x = numberIn(a, "x");
        const y = numberIn(a, "y");
        const width = numberIn(a, "width");
        const height = numberIn(a, "height");
        // SVG takes a missing corner radius from the other one.
        const rx = Math.min(Number(a["rx"] ?? a["ry"] ?? 0), width / 2);
        const ry = Math.min(Number(a["ry"] ?? a["rx"] ?? 0), height / 2);
        const across = width - 2 * rx;
        const down = height - 2 * ry;
        return [
          `M${x + rx} ${y}h${across}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${down}` +
            `a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-across}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}` +
            `v${-down}a${rx} ${ry} 0 0 1 ${rx} ${-ry}z`,
        ];
      }
      case "polyline":
        return [pointsPath(a)];
      case "polygon":
        return [`${pointsPath(a)}z`];
      default:
        return [];
    }
  });

/**
 * Lanes for markers placed along a line, counted from the line up, so that markers in one lane
 * keep `spacing` between their centers. From left to right each marker takes the lowest lane whose
 * last marker is far enough away. Where every lane is too close, as can happen with more markers
 * than lanes, it takes the lane whose last marker is farthest away.
 */
export const lanesFor = (
  positions: readonly number[],
  spacing: number,
  lanes: number,
): number[] => {
  const ends = Array.from({ length: Math.max(1, lanes) }, () => Number.NEGATIVE_INFINITY);
  const result = positions.map(() => 0);
  const order = positions
    .map((_, index) => index)
    .toSorted((first, second) => (positions[first] ?? 0) - (positions[second] ?? 0));
  for (const index of order) {
    const at = positions[index] ?? 0;
    let lane = ends.findIndex((end) => at - end >= spacing);
    if (lane === -1) {
      lane = ends.indexOf(Math.min(...ends));
    }
    ends[lane] = at;
    result[index] = lane;
  }
  return result;
};

import {
  Ban,
  CircleX,
  CloudOff,
  CopyX,
  FileQuestionMark,
  HardDrive,
  History,
  Lock,
  Maximize2,
  ServerCrash,
  Split,
  TimerOff,
  type LucideIconData,
} from "@lucide/icons";
import {
  Copy,
  createLucideIcon,
  File,
  FolderInput,
  FolderPlus,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { EntryKind } from "../api/dav";
import type { OperationError } from "../api/queries";
import { relativeSpan } from "../shell/format";

/** Why an operation failed, as a picture and in a word or two. */
export interface Cause {
  /** The cause in words, such as "Timed out". */
  label: string;
  /** What happened, in a sentence. */
  reason: string;
  /** The picture as Lucide's icon data, which the errors timeline draws as paths. */
  glyph: LucideIconData;
  /** The same picture as a component, for Astryx Icon. */
  icon: LucideIcon;
}

const cause = (label: string, reason: string, glyph: LucideIconData): Cause => ({
  label,
  reason,
  glyph,
  icon: createLucideIcon(glyph),
});

// The statuses WebDAV operations fail with (RFC 9110 §15, RFC 4918 §11), each named for what the
// owner of the instance would do about it.
const CAUSES: ReadonlyMap<number, Cause> = new Map([
  [400, cause("Bad request", "The client sent a request Davloom could not read.", CircleX)],
  [403, cause("Not allowed", "The key may not do this here.", Ban)],
  [404, cause("Not found", "Nothing has this name.", FileQuestionMark)],
  [405, cause("Not allowed here", "This name holds something this operation cannot change.", Ban)],
  [409, cause("Conflict", "The folder it needs is missing.", Split)],
  [413, cause("Too large", "The upload is larger than one request may carry.", Maximize2)],
  [423, cause("Locked", "Another client holds a lock on it.", Lock)],
  [500, cause("Server error", "Davloom failed while handling the request.", ServerCrash)],
  [502, cause("Other backend", "Copies and moves stay within one backend.", Split)],
  [503, cause("Backend unavailable", "The backend did not answer.", CloudOff)],
  [504, cause("Timed out", "The backend did not answer in time.", TimerOff)],
  [507, cause("Storage full", "The backend has no room left.", HardDrive)],
]);

const ALREADY_EXISTS = cause(
  "Already exists",
  "The destination exists, and the client asked not to overwrite it.",
  CopyX,
);
const CHANGED = cause(
  "Changed since",
  "It changed after the client last read it, so the client's condition no longer held.",
  History,
);
const FAILED = cause("Failed", "The operation failed.", CircleX);

/**
 * Why an operation failed. A MOVE or COPY with `Overwrite: F` onto a name that exists fails with
 * 412, so a 412 from those two reads as a name that already exists; any other 412 is a condition
 * of the request, such as an `If-Match`, that no longer held.
 */
export const causeOf = (error: Pick<OperationError, "status" | "method">): Cause => {
  if (error.status === 412) {
    return error.method === "MOVE" || error.method === "COPY" ? ALREADY_EXISTS : CHANGED;
  }
  return CAUSES.get(error.status) ?? FAILED;
};

const METHOD_ICONS: ReadonlyMap<string, LucideIcon> = new Map([
  ["COPY", Copy],
  ["DELETE", Trash2],
  ["MKCOL", FolderPlus],
  ["MOVE", FolderInput],
  ["PUT", Upload],
]);

/** A picture of an operation's method, such as an upload arrow for PUT. */
export const methodIconOf = (error: Pick<OperationError, "method">): LucideIcon =>
  METHOD_ICONS.get(error.method) ?? File;

/** The name of the file or folder an operation failed on: the last part of its path. */
export const nameOf = (error: Pick<OperationError, "path">): string =>
  error.path.split("/").findLast((part) => part !== "") ?? "/";

/** Whether an operation was on a folder: MKCOL makes one, and a path ending in / names one. */
export const kindOf = (error: Pick<OperationError, "path" | "method">): EntryKind =>
  error.method === "MKCOL" || error.path.endsWith("/") ? "folder" : "file";

/** The request as a line: its method and path, and where a COPY or MOVE was to go. */
export const requestOf = (error: Pick<OperationError, "method" | "path" | "destination">) =>
  error.destination === null
    ? `${error.method} ${error.path}`
    : `${error.method} ${error.path} → ${error.destination}`;

/** Whole minutes between an operation and `now`. */
export const minutesAgo = (iso: string, now: Date): number =>
  Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));

const inUnit = (unit: "minute" | "hour" | "day" | "month" | "year") =>
  new Intl.NumberFormat("en", { style: "unit", unit, unitDisplay: "narrow" });
const inMinutes = inUnit("minute");
const inHours = inUnit("hour");
const inDays = inUnit("day");

/** A span of minutes as short as it gets, such as "10m", "6h" or "2d", for the timeline's ticks. */
export const shortSpan = (minutes: number): string => {
  if (minutes < 60) {
    return inMinutes.format(Math.round(minutes));
  }
  if (minutes < 24 * 60) {
    return inHours.format(Math.round(minutes / 60));
  }
  return inDays.format(Math.round(minutes / (24 * 60)));
};

/**
 * How long ago a time was, as short as it gets, such as "12m", "5h" or "2d". It shows the count and
 * the unit that `formatRelative` reads out, so "1h" and "1 hour ago" always name the same age.
 */
export const shortAge = (iso: string, now: Date = new Date()): string => {
  const { count, unit } = relativeSpan(iso, now);
  return inUnit(unit).format(Math.abs(count));
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

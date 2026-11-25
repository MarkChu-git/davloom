import {
  Ban,
  CircleX,
  CloudOff,
  CopyX,
  HardDrive,
  History,
  Lock,
  Maximize2,
  TimerOff,
} from "@lucide/icons";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { OperationError } from "../api/queries";
import { formatRelative } from "../shell/format";
import {
  causeOf,
  glyphPaths,
  kindOf,
  lanesFor,
  methodIconOf,
  minutesAgo,
  nameOf,
  requestOf,
  shortAge,
  shortSpan,
} from "./errors";

const NOW = new Date("2026-11-24T15:30:00Z");

const sample = (patch: Partial<OperationError>): OperationError => ({
  id: "x",
  method: "PUT",
  path: "/documents/notes.md",
  destination: null,
  status: 500,
  at: "2026-11-24T15:00:00Z",
  ...patch,
});

describe("an error's cause", () => {
  // A 412 says a name exists only for MOVE and COPY, which fail so with `Overwrite: F`.
  it.each([
    [400, "PUT", "Bad request"],
    [403, "PUT", "Not allowed"],
    [404, "DELETE", "Not found"],
    [405, "MKCOL", "Not allowed here"],
    [409, "PUT", "Conflict"],
    [412, "MOVE", "Already exists"],
    [412, "COPY", "Already exists"],
    [412, "PUT", "Changed since"],
    [413, "PUT", "Too large"],
    [423, "PUT", "Locked"],
    [500, "PUT", "Server error"],
    [502, "COPY", "Other backend"],
    [503, "GET", "Backend unavailable"],
    [504, "PUT", "Timed out"],
    [507, "PUT", "Storage full"],
    [418, "PUT", "Failed"],
  ])("status %i of a %s is %s", (status, method, label) => {
    const cause = causeOf(sample({ status, method }));
    expect(cause.label).toBe(label);
    expect(cause.reason).toMatch(/\.$/);
  });

  it("gives every status a cause with a picture and a reason", () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 599 }), fc.string(), (status, method) => {
        const cause = causeOf({ status, method });
        expect(cause.label).not.toBe("");
        expect(cause.reason).not.toBe("");
        expect(cause.glyph.node.length).toBeGreaterThan(0);
      }),
    );
  });
});

describe("an error's name, kind, method and request", () => {
  it.each([
    ["/photos/2026/holiday.mov", "holiday.mov", "PUT", "file"],
    ["/documents/Scans/", "Scans", "DELETE", "folder"],
    ["/documents/New", "New", "MKCOL", "folder"],
    ["/", "/", "PROPFIND", "folder"],
  ])("%s is %s, a %s on a %s", (path, name, method, kind) => {
    expect(nameOf(sample({ path }))).toBe(name);
    expect(kindOf(sample({ path, method }))).toBe(kind);
  });

  it("names a request with its destination", () => {
    expect(requestOf(sample({}))).toBe("PUT /documents/notes.md");
    expect(requestOf(sample({ method: "MOVE", destination: "/b/notes.md" }))).toBe(
      "MOVE /documents/notes.md → /b/notes.md",
    );
  });

  it("draws a picture for each method, and a file for any other", () => {
    const icons = ["COPY", "DELETE", "MKCOL", "MOVE", "PUT", "LOCK"].map((method) =>
      methodIconOf({ method }),
    );
    expect(new Set(icons).size).toBe(6);
  });
});

describe("a short span of minutes", () => {
  it.each([
    [0, "0m"],
    [12, "12m"],
    [59, "59m"],
    [60, "1h"],
    [95, "2h"],
    [310, "5h"],
    [24 * 60, "1d"],
  ])("%i minutes is %s", (minutes, text) => {
    expect(shortSpan(minutes)).toBe(text);
  });
});

/** A time the given minutes before NOW. */
const ago = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe("an operation's age", () => {
  // Half units and the minutes either side of them, where rounding apart from the words would
  // disagree with them: the short form shows the count and unit the words read out.
  it.each([
    [12, "12m", "12 minutes ago"],
    [59.5, "59m", "59 minutes ago"],
    [90, "1h", "1 hour ago"],
    [90.4, "2h", "2 hours ago"],
    [150, "2h", "2 hours ago"],
    [36 * 60, "1d", "yesterday"],
    [60 * 60, "2d", "2 days ago"],
  ])("%f minutes ago is %s, read as %s", (minutes, short, words) => {
    expect(shortAge(ago(minutes), NOW)).toBe(short);
    expect(formatRelative(ago(minutes), NOW)).toBe(words);
  });

  it("counts whole minutes, and none for a time to come", () => {
    expect(minutesAgo(ago(12.4), NOW)).toBe(12);
    expect(minutesAgo(ago(-5), NOW)).toBe(0);
  });
});

describe("a cause's picture as paths", () => {
  it.each([
    ["CopyX", CopyX],
    ["Maximize2", Maximize2],
    ["Lock", Lock],
    ["TimerOff", TimerOff],
    ["CircleX", CircleX],
    ["Ban", Ban],
    ["CloudOff", CloudOff],
    ["HardDrive", HardDrive],
    ["History", History],
  ])("%s keeps every shape", (_, glyph) => {
    const paths = glyphPaths(glyph);
    expect(paths).toHaveLength(glyph.node.length);
    for (const path of paths) {
      expect(path).toMatch(/^[Mm]/);
      expect(path).not.toMatch(/NaN|undefined/);
    }
  });

  it("draws rectangles, circles, ellipses, lines, polylines and polygons where Lucide does", () => {
    expect(
      glyphPaths({ name: "box", node: [["rect", { x: 2, y: 4, width: 20, height: 10, rx: 2 }]] }),
    ).toEqual(["M4 4h16a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2z"]);
    expect(glyphPaths({ name: "dot", node: [["circle", { cx: 12, cy: 12, r: 10 }]] })).toEqual([
      "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z",
    ]);
    expect(
      glyphPaths({ name: "egg", node: [["ellipse", { cx: 12, cy: 12, rx: 4, ry: 2 }]] }),
    ).toEqual(["M8 12a4 2 0 1 0 8 0a4 2 0 1 0 -8 0z"]);
    expect(glyphPaths({ name: "l", node: [["line", { x1: 1, y1: 2, x2: 3, y2: 4 }]] })).toEqual([
      "M1 2L3 4",
    ]);
    expect(
      glyphPaths({ name: "tick", node: [["polyline", { points: "20 6 9 17 4 12" }]] }),
    ).toEqual(["M20 6L9 17L4 12"]);
    expect(glyphPaths({ name: "tri", node: [["polygon", { points: "1,1 2,2 3,1" }]] })).toEqual([
      "M1 1L2 2L3 1z",
    ]);
    expect(glyphPaths({ name: "other", node: [["g", {}]] })).toEqual([]);
  });
});

// Markers on the timeline must never cover each other. Each lane keeps its markers `spacing`
// apart, so with a lane for every marker no two markers in one lane come closer than that.
describe("timeline lanes", () => {
  const positions = fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 12 });
  const spacing = fc.integer({ min: 1, max: 100 });

  it("keeps the markers of one lane apart while there are enough lanes", () => {
    fc.assert(
      fc.property(positions, spacing, fc.integer({ min: 0, max: 4 }), (at, gap, extra) => {
        const lanes = at.length + extra;
        const chosen = lanesFor(at, gap, lanes);
        expect(chosen).toHaveLength(at.length);
        for (const lane of chosen) {
          expect(lane).toBeGreaterThanOrEqual(0);
          expect(lane).toBeLessThan(Math.max(1, lanes));
        }
        for (let first = 0; first < at.length; first += 1) {
          for (let second = first + 1; second < at.length; second += 1) {
            if (chosen[first] === chosen[second]) {
              expect(Math.abs((at[first] ?? 0) - (at[second] ?? 0))).toBeGreaterThanOrEqual(gap);
            }
          }
        }
      }),
    );
  });

  it("lifts a marker that comes closer than the spacing, and keeps one at the spacing", () => {
    expect(lanesFor([0, 15, 30], 20, 3)).toEqual([0, 1, 0]);
    expect(lanesFor([0, 20], 20, 2)).toEqual([0, 0]);
    expect(lanesFor([0, 19], 20, 2)).toEqual([0, 1]);
  });

  it("stays within its lanes when there are too few", () => {
    expect(lanesFor([0, 1, 2, 3], 10, 2)).toEqual([0, 1, 0, 1]);
    expect(lanesFor([5, 5, 5], 10, 1)).toEqual([0, 0, 0]);
  });
});

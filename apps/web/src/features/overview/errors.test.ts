import { CircleX, CopyX, Lock, Maximize2, TimerOff } from "@lucide/icons";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { recentErrors, SAMPLE_NOW, type OperationError } from "../sample-data/data";
import { formatRelative } from "../sample-data/format";
import { causeOf, glyphPaths, lanesFor, nameOf, shortAge, shortSpan } from "./errors";

const sample = (patch: Partial<OperationError>): OperationError => ({
  id: "x",
  method: "PUT",
  path: "/documents/notes.md",
  kind: "file",
  status: 500,
  message: "",
  at: "2026-11-16T15:00:00Z",
  ...patch,
});

describe("an error's cause", () => {
  // A 412 says a name exists only for MOVE and COPY, which fail so with `Overwrite: F`.
  it.each([
    [412, "MOVE", "Already exists"],
    [412, "COPY", "Already exists"],
    [412, "PUT", "Failed"],
    [413, "PUT", "Too large"],
    [423, "PUT", "Locked"],
    [504, "PUT", "Timed out"],
    [500, "PUT", "Failed"],
  ])("status %i of a %s is %s", (status, method, label) => {
    expect(causeOf(sample({ status, method })).label).toBe(label);
  });

  it("names every sample error's cause", () => {
    expect(recentErrors.map((error) => causeOf(error).label)).not.toContain("Failed");
  });
});

describe("an error's name", () => {
  it.each([
    ["/photos/2026/holiday.mov", "holiday.mov"],
    ["/documents/Drafts → /shared/Drafts", "Drafts"],
    ["/documents/Scans/", "Scans"],
    ["/", "/"],
  ])("%s is %s", (path, name) => {
    expect(nameOf(sample({ path }))).toBe(name);
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

/** A time the given minutes before the sample clock. */
const ago = (minutes: number): string =>
  new Date(SAMPLE_NOW.getTime() - minutes * 60_000).toISOString();

describe("an operation's short age", () => {
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
    expect(shortAge(ago(minutes))).toBe(short);
    expect(formatRelative(ago(minutes))).toBe(words);
  });
});

describe("a cause's picture as paths", () => {
  it.each([
    ["CopyX", CopyX],
    ["Maximize2", Maximize2],
    ["Lock", Lock],
    ["TimerOff", TimerOff],
    ["CircleX", CircleX],
  ])("%s keeps every shape", (_, glyph) => {
    const paths = glyphPaths(glyph);
    expect(paths).toHaveLength(glyph.node.length);
    for (const path of paths) {
      // Lucide's own paths start with a relative move, which SVG reads as absolute.
      expect(path).toMatch(/^[Mm]/);
      expect(path).not.toMatch(/NaN|undefined/);
    }
  });

  it("draws a rounded rectangle and a circle where Lucide does", () => {
    expect(
      glyphPaths({ name: "box", node: [["rect", { x: 2, y: 4, width: 20, height: 10, rx: 2 }]] }),
    ).toEqual(["M4 4h16a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2z"]);
    expect(glyphPaths({ name: "dot", node: [["circle", { cx: 12, cy: 12, r: 10 }]] })).toEqual([
      "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z",
    ]);
    expect(
      glyphPaths({ name: "tick", node: [["polyline", { points: "20 6 9 17 4 12" }]] }),
    ).toEqual(["M20 6L9 17L4 12"]);
  });
});

// Markers on the timeline must never cover each other. Each lane keeps its markers `spacing`
// apart, so with a lane for every marker no two markers in one lane come closer than that.
describe("timeline lanes", () => {
  // Whole numbers drawn evenly. Doubles from fast-check lean towards the very small and the very
  // large, which leaves out markers between half the spacing and the spacing apart.
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

  it("puts markers that are already apart on the line itself", () => {
    // Whole numbers, so the sums that space the markers are exact.
    const steps = fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 12 });
    fc.assert(
      fc.property(steps, fc.integer({ min: 1, max: 100 }), (between, gap) => {
        let at = 0;
        const apart = between.map((step) => (at += gap + step));
        expect(lanesFor(apart.toReversed(), gap, 2)).toEqual(apart.map(() => 0));
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

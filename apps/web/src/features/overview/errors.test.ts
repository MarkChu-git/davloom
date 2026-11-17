import { CircleX, CopyX, Lock, Maximize2, TimerOff } from "@lucide/icons";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { recentErrors, type OperationError } from "../sample-data/data";
import { causeOf, glyphPaths, lanesFor, nameOf, shortSpan } from "./errors";

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
  it.each([
    [412, "Already exists"],
    [413, "Too large"],
    [423, "Locked"],
    [504, "Timed out"],
    [500, "Failed"],
  ])("status %i is %s", (status, label) => {
    expect(causeOf(sample({ status })).label).toBe(label);
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

describe("a short age", () => {
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

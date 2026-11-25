import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperationError, OperationHour } from "../api/queries";
import { translator } from "../i18n/translate";
import { describeOperations, ErrorTimeline, hourPoints, OperationsChart } from "./charts";
import { glyphPaths } from "./errors";

// The Operations chart and the errors timeline: their tooltips with a mouse and with a finger, and
// the edges of their data.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Makes the device's main pointer a finger, or a mouse. */
const en = translator("en");

const pointWith = (isFinger: boolean) => {
  const matchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const list = matchMedia(query);
    Object.defineProperty(list, "matches", { value: query === "(pointer: coarse)" && isFinger });
    return list;
  });
};

const NOW = Date.UTC(2026, 10, 24, 15, 30);

const HOURS: OperationHour[] = Array.from({ length: 24 }, (_, index) => ({
  start: new Date(Date.UTC(2026, 10, 24, 15) - (23 - index) * 3_600_000).toISOString(),
  operations: index === 23 ? 9 : index === 20 ? 4 : 0,
  failed: index === 23 ? 2 : 0,
}));

const ERRORS: OperationError[] = [
  {
    id: "e1",
    at: new Date(NOW - 5 * 60_000).toISOString(),
    method: "PUT",
    path: "/files/big.mov",
    destination: null,
    status: 413,
  },
  {
    id: "e2",
    at: new Date(NOW - 6 * 60_000).toISOString(),
    method: "COPY",
    path: "/files/a",
    destination: "/files/b",
    status: 412,
  },
  {
    id: "old",
    at: new Date(NOW - 30 * 3_600_000).toISOString(),
    method: "PUT",
    path: "/files/old",
    destination: null,
    status: 500,
  },
];

describe("hourPoints and describeOperations", () => {
  it("counts hours back from the last one", () => {
    expect(hourPoints(HOURS).at(-1)).toEqual({ hoursAgo: 0, operations: 9, failed: 2 });
    expect(hourPoints(HOURS)[0]?.hoursAgo).toBe(23);
    expect(hourPoints([])).toEqual([]);
  });

  it("names the busiest hour, now or before", () => {
    expect(describeOperations(en, hourPoints(HOURS))).toBe(
      "13 operations, 2 of them failed, now. The busiest hour is now, with 9.",
    );
    expect(
      describeOperations(en, [
        { hoursAgo: 2, operations: 5, failed: 0 },
        { hoursAgo: 0, operations: 1, failed: 0 },
      ]),
    ).toBe("6 operations, 0 of them failed. The busiest hour was 2 hours ago, with 5.");
  });

  it("names the busiest hour in Chinese", () => {
    const text = describeOperations(translator("zh-CN"), hourPoints(HOURS));
    expect(text).toContain("13");
    expect(text).not.toMatch(/[A-Za-z]/);
  });
});

describe("OperationsChart", () => {
  it.each([false, true])("shows an hour's operations and failures (finger: %s)", async (finger) => {
    pointWith(finger);
    render(<OperationsChart hours={HOURS} />);
    const chart = screen.getByRole("img", { name: "Operations per hour, last 24 hours" });
    act(() => chart.focus());
    fireEvent.keyDown(chart, { key: "End" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    await waitFor(() => expect(document.body.textContent).toMatch(/Operations\d/));
  });

  it("draws a chart for no hours at all", () => {
    render(<OperationsChart hours={[]} />);
    expect(
      screen.getByRole("img", { name: "Operations per hour, last 24 hours" }).querySelector("desc")
        ?.textContent,
    ).toBe("No operations in the last 24 hours.");
  });
});

describe("ErrorTimeline", () => {
  it.each([false, true])(
    "describes the day's errors and shows one (finger: %s)",
    async (finger) => {
      pointWith(finger);
      render(<ErrorTimeline errors={ERRORS} now={NOW} />);
      const chart = screen.getByRole("img", { name: "Operation errors, last 24 hours" });
      expect(chart.querySelector("desc")?.textContent).toBe(
        "2 operations failed in the last 24 hours. a: already exists, 6 minutes ago. big.mov: too large, 5 minutes ago.",
      );
      act(() => chart.focus());
      fireEvent.keyDown(chart, { key: "ArrowRight" });
      await waitFor(() => expect(document.body.textContent).toMatch(/413|412/));
    },
  );

  it("describes a single error in the singular", () => {
    render(<ErrorTimeline errors={ERRORS.slice(0, 1)} now={NOW} />);
    expect(
      screen.getByRole("img", { name: "Operation errors, last 24 hours" }).querySelector("desc")
        ?.textContent,
    ).toMatch(/^1 operation failed/);
  });
});

describe("glyphPaths, edge cases", () => {
  it("reads missing and odd attributes as Lucide would", () => {
    expect(glyphPaths({ name: "r", node: [["rect", { width: 4, height: 2 }]] })[0]).toMatch(
      /^M0 0h4a0 0 0 0 1 0 0v2/,
    );
    expect(glyphPaths({ name: "r", node: [["rect", { width: 4, height: 2, ry: 1 }]] })[0]).toMatch(
      /^M1 0/,
    );
    expect(glyphPaths({ name: "p", node: [["path", { d: 5 }]] })).toEqual(["5"]);
    expect(glyphPaths({ name: "p", node: [["path", {}]] })).toEqual([""]);
    expect(glyphPaths({ name: "l", node: [["polyline", { points: "1 2 3" }]] })).toEqual(["M1 2"]);
  });
});

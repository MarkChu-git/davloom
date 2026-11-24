import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { StorageChart, type BackendBar } from "./charts";

// happy-dom has no canvas, so the chart's labels would always be estimated from the font size
// (OverviewPage.test.tsx draws them that way). Here a canvas measures them, with the metrics each
// test sets. The chart keeps the first canvas it finds, so it is in place before the first render.

type Metrics = { width: number; ascent: number; descent: number };

let metrics: Metrics = { width: 30, ascent: 9, descent: 3 };
const fonts: string[] = [];

const measureText = (label: string) => ({
  width: label === "" ? 0 : metrics.width,
  actualBoundingBoxAscent: metrics.ascent,
  actualBoundingBoxDescent: metrics.descent,
});

/** The canvas's context. Older browsers have no fontStretch or letterSpacing on it. */
const context: {
  font: string;
  fontStretch?: string;
  letterSpacing?: string;
  textBaseline: string;
  direction: string;
  measureText: (label: string) => ReturnType<typeof measureText>;
} = {
  font: "",
  textBaseline: "alphabetic",
  direction: "ltr",
  measureText(label: string) {
    fonts.push(context.font);
    return measureText(label);
  },
};

const withModernCanvas = () => {
  context.fontStretch = "normal";
  context.letterSpacing = "0px";
};

beforeAll(() => {
  withModernCanvas();
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => context,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  metrics = { width: 30, ascent: 9, descent: 3 };
  fonts.length = 0;
  withModernCanvas();
});

const BARS: BackendBar[] = [
  { name: "Small", bytes: 100, objects: 3 },
  { name: "Large", bytes: 5000, objects: 7 },
  { name: "Empty", bytes: 0, objects: 0 },
];

const chart = () => screen.getByRole("img", { name: "Bytes stored on each backend" });

/** Where the chart starts its name labels on the y axis, which leaves room for the longest. */
const labelEdge = (): number =>
  Number(chart().querySelector('[data-ts-key^="y-tick-label"]')?.getAttribute("x"));

/** Makes the device's main pointer a finger, or a mouse. */
const pointWith = (isFinger: boolean) => {
  const matchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const list = matchMedia(query);
    Object.defineProperty(list, "matches", { value: query === "(pointer: coarse)" && isFinger });
    return list;
  });
};

describe("StorageChart", () => {
  it.each([
    { bars: [], description: ".", height: 44 },
    { bars: BARS.slice(0, 1), description: "Small stores 100 bytes.", height: 44 },
    {
      bars: BARS,
      description: "Large stores 5 kB, Small stores 100 bytes, and Empty stores 0 bytes.",
      height: 132,
    },
  ])("describes $bars.length bars, largest first", ({ bars, description, height }) => {
    render(<StorageChart bars={bars} />);
    expect(chart().querySelector("desc")?.textContent).toBe(description);
    expect(chart().getAttribute("viewBox")?.split(" ")[3]).toBe(String(height));
  });

  it("labels each bar with its size and each row with its backend", () => {
    render(<StorageChart bars={BARS} />);
    const labels = [...chart().querySelectorAll("text")].map((text) => text.textContent);
    expect(labels).toEqual(["5 kB", "100 bytes", "0 bytes", "Large", "Small", "Empty"]);
  });

  it.each([
    { pointer: "a mouse", isFinger: false },
    { pointer: "a finger", isFinger: true },
  ])("shows the focused backend's size and objects with $pointer", async ({ isFinger }) => {
    pointWith(isFinger);
    render(<StorageChart bars={BARS} />);
    act(() => chart().focus());
    // The arrow keys move the focus from one backend's bar to another's.
    fireEvent.keyDown(chart(), { key: "ArrowDown" });
    fireEvent.keyDown(chart(), { key: "ArrowRight" });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(
        /(Large|Small|Empty)Stored(5 kB|100 bytes|0 bytes)Objects[037]$/,
      ),
    );
  });

  it("makes room on the left for the longest name as the canvas measures it", () => {
    metrics = { width: 20, ascent: 9, descent: 3 };
    render(<StorageChart bars={BARS} />);
    const narrow = labelEdge();
    cleanup();
    metrics = { width: 80, ascent: 9, descent: 3 };
    render(<StorageChart bars={BARS} />);
    expect(labelEdge()).toBeGreaterThan(narrow);
    expect(fonts.some((font) => font.includes("12px"))).toBe(true);
  });

  it.each([
    { title: "no ink", metrics: { width: 30, ascent: 0, descent: 0 } },
    { title: "metrics it cannot read", metrics: { width: 30, ascent: Number.NaN, descent: 3 } },
    { title: "labels of no width", metrics: { width: 0, ascent: 0, descent: 0 } },
  ])("still lays out its labels for a canvas with $title", ({ metrics: next }) => {
    metrics = next;
    render(<StorageChart bars={BARS} />);
    expect(Number.isFinite(labelEdge())).toBe(true);
    expect(chart().querySelectorAll("text")).toHaveLength(6);
  });
});

describe("StorageChart, right to left", () => {
  it("measures its labels from their right edge", () => {
    render(
      <div dir="rtl" style={{ direction: "rtl" }}>
        <StorageChart bars={BARS} />
      </div>,
    );
    expect(chart().getAttribute("direction")).toBe("rtl");
    expect(chart().querySelectorAll("text")).toHaveLength(6);
  });
});

describe("StorageChart, in a condensed font", () => {
  it("measures its labels in the stretch the chart draws them in", () => {
    render(
      <div style={{ fontStretch: "87.5%" }}>
        <StorageChart bars={BARS} />
      </div>,
    );
    expect(context.fontStretch).toBe("semi-condensed");
    expect(chart().querySelectorAll("text")).toHaveLength(6);
  });
});

describe("StorageChart, on an older canvas", () => {
  it("measures its labels without font stretch or letter spacing", () => {
    delete context.fontStretch;
    delete context.letterSpacing;
    render(<StorageChart bars={BARS} />);
    expect(fonts.length).toBeGreaterThan(0);
    expect(context.fontStretch).toBeUndefined();
    expect(chart().querySelectorAll("text")).toHaveLength(6);
  });
});

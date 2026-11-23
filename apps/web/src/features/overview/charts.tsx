import {
  borderVars,
  colorVars,
  radiusVars,
  shadowVars,
  textSizeVars,
  typographyVars,
} from "@astryxdesign/core/theme/tokens.stylex";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { VStack } from "@astryxdesign/core/Layout";
import * as stylex from "@stylexjs/stylex";
import { barX, defineChart, text, type ChartTextMeasurer } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { portal } from "@tanstack/charts/tooltip/portal";
import { useMemo } from "react";
import { formatBytes, formatCount } from "../shell/format";
import { TouchHold } from "./TouchHold";

// Davloom draws in grays and keeps hues for statuses (see packages/ui/src/tokens/monochrome), so
// the charts draw in the ink of the accent on the card's surface, and the theme's grays carry the
// axes and labels. The paints are the theme's own CSS variables,
// so a chart follows the color mode without being rebuilt.
const INK = colorVars["--color-accent"];
const SURFACE = colorVars["--color-background-card"];
const RULE = colorVars["--color-border"];
const LABEL = colorVars["--color-text-primary"];
const AXIS = colorVars["--color-text-secondary"];

/**
 * The room TanStack Charts keeps between a chart's edge and its outermost labels, in pixels: its
 * `automaticGuideInset`, which it does not export.
 */
const GUIDE_INSET = 4;

const styles = stylex.create({
  // TanStack Charts reads its palette and tooltip chrome from these variables, and falls back to
  // colored defaults where one is missing, so each is set to a gray of the theme.
  chart: {
    color: AXIS,
    fontFamily: typographyVars["--font-family-body"],
    fontSize: textSizeVars["--font-size-xs"],
    "--ts-chart-1": INK,
    "--ts-chart-2": INK,
    "--ts-chart-3": INK,
    "--ts-chart-4": INK,
    "--ts-chart-5": INK,
    "--ts-chart-6": INK,
    "--ts-chart-focus-fill": SURFACE,
    "--ts-chart-crosshair-label-halo": SURFACE,
    "--ts-chart-crosshair-marker-fill": SURFACE,
    "--ts-chart-tooltip-background": colorVars["--color-background-popover"],
    "--ts-chart-tooltip-color": LABEL,
    "--ts-chart-tooltip-border": `${borderVars["--border-width"]} solid ${RULE}`,
    "--ts-chart-tooltip-border-radius": radiusVars["--radius-element"],
    "--ts-chart-tooltip-shadow": shadowVars["--shadow-med"],
    "--ts-chart-tooltip-font": `500 ${textSizeVars["--font-size-xs"]}/1.3 ${typographyVars["--font-family-body"]}`,
  },
  // A chart with axes reaches into its card's padding by the room TanStack Charts keeps outside
  // its labels, so the longest label on the y axis starts where the card's title does, and the
  // last label on the x axis ends at the edge of the card's content.
  reach: {
    marginInline: -GUIDE_INSET,
  },
});

let labelCanvas: CanvasRenderingContext2D | null | undefined;

const STRETCHES = [
  "ultra-condensed",
  "extra-condensed",
  "condensed",
  "semi-condensed",
  "normal",
  "semi-expanded",
  "expanded",
  "extra-expanded",
  "ultra-expanded",
] as const;

/**
 * Measures a label as TanStack Charts does in a browser, on a canvas in the font the chart draws
 * it in, except for its width. TanStack takes a label's ink, which set the longest label on the y
 * axis a side bearing out from where the card's title starts. This takes the label's advance, the
 * box a line of text fills, so the label and the title line up as two lines of text do. The height
 * stays the ink's, as TanStack measures it, so each chart keeps its vertical layout. Where there is
 * no canvas, as on a server, it estimates from the font size.
 */
const measureLabel: ChartTextMeasurer = (label, options) => {
  const scale = Number.isFinite(options.fontScale) && options.fontScale > 0 ? options.fontScale : 1;
  const size = options.fontSize * scale;
  if (labelCanvas === undefined && typeof document !== "undefined") {
    labelCanvas = document.createElement("canvas").getContext("2d");
  }
  const startsAtLeft = options.direction !== "rtl";
  const offset = (width: number) =>
    options.anchor === "middle"
      ? -width / 2
      : (options.anchor === "start") === startsAtLeft
        ? 0
        : -width;
  const estimate = {
    y: options.baseline === "middle" ? -size / 2 : options.baseline === "hanging" ? 0 : -size * 0.8,
    height: size,
  };
  if (!labelCanvas) {
    const width = Array.from(label).length * size * 0.55;
    return { x: offset(width), width, ...estimate };
  }
  // Where a label names no weight, TanStack takes the chart's own, which is the body's 400.
  labelCanvas.font = `${options.fontStyle} ${options.fontWeight ?? 400} ${size}px ${options.fontFamily}`;
  if ("fontStretch" in labelCanvas) {
    labelCanvas.fontStretch =
      STRETCHES.find((stretch) => stretch === options.fontStretch) ?? "normal";
  }
  labelCanvas.textBaseline = options.baseline === "auto" ? "alphabetic" : options.baseline;
  labelCanvas.direction = options.direction;
  if ("letterSpacing" in labelCanvas) {
    labelCanvas.letterSpacing = `${options.letterSpacing * scale}px`;
  }
  const measured = labelCanvas.measureText(label);
  const ascent = measured.actualBoundingBoxAscent;
  const descent = measured.actualBoundingBoxDescent;
  const inked =
    Number.isFinite(ascent) &&
    Number.isFinite(descent) &&
    (ascent + descent > 0 || measured.width === 0);
  return {
    x: offset(measured.width),
    width: measured.width,
    ...(inked ? { y: -ascent, height: ascent + descent } : estimate),
  };
};

const theme = {
  foreground: AXIS,
  muted: AXIS,
  grid: RULE,
  background: "transparent",
  palette: [INK],
};

/** A device whose main pointer is a finger, such as a phone or a tablet. */
const FINGER = "(pointer: coarse)";

// A finger that holds a chart covers the point it holds, and the hand covers the plot below. Where
// a finger is the main pointer, a chart shows a point's values above the plot, in line with the
// point, and the portal lets them rise out of the chart's own box to get there.
const ABOVE_THE_PLOT = {
  anchor: { x: "point", y: "plot-top" },
  placement: "top",
  portal,
} as const;

/**
 * Axis and bar labels in pixels, as TanStack Charts measures them: the theme's small size at a
 * 16 px root. The tooltip takes the theme's extra-small size instead, 10 px with a mouse and 12 px
 * where a touch screen's type scale is a step larger.
 */
const TEXT_SIZE = 12;

const list = new Intl.ListFormat("en");

/** One bar: a backend and what it stores. */
export type BackendBar = { name: string; bytes: number; objects: number };

// The backend in focus keeps its bar and its size, and the others fade, which is how a bar shows
// focus. The ring that TanStack Charts draws on a focused point suits a line, and here the bar and
// its size each drew one, side by side at the tip.
const OTHERS_FADE = [{ when: { focus: "unmatched" }, style: { opacity: 0.35 } }] as const;

const defineStorage = (bars: readonly BackendBar[], isFinger: boolean) => {
  const largest = Math.max(1, ...bars.map((bar) => bar.bytes));
  return defineChart({
    marks: [
      barX(bars, {
        x: "bytes",
        y: "name",
        fill: INK,
        maxThickness: 12,
        radius: { end: 4 },
        states: OTHERS_FADE,
      }),
      // Each bar's size at its tip, in the theme's text color rather than the bar's ink.
      text(bars, {
        x: "bytes",
        y: "name",
        text: (bar) => formatBytes(bar.bytes),
        anchor: "start",
        dx: 8,
        fill: LABEL,
        fontSize: TEXT_SIZE,
        fontWeight: 500,
        states: OTHERS_FADE,
      }),
    ],
    focusRing: false,
    scales: {
      // Room past the longest bar for its label.
      x: { scale: scaleLinear().domain([0, largest * 1.3]), axis: false },
      y: {
        scale: () => scaleBand().padding(0.45),
        axis: { line: false, ticks: { line: false }, tickLabels: { fontSize: TEXT_SIZE } },
      },
    },
    theme,
    tooltip: {
      use: tooltip,
      ...(isFinger ? ABOVE_THE_PLOT : {}),
      content: (points) => {
        const bar = points[0]?.datum;
        if (bar === undefined) {
          return { rows: [] };
        }
        return {
          title: bar.name,
          rows: [
            { label: "Stored", value: formatBytes(bar.bytes) },
            { label: "Objects", value: formatCount(bar.objects) },
          ],
        };
      },
    },
  });
};

/** Bytes stored on each backend, largest first. */
export const StorageChart = ({ bars }: { bars: readonly BackendBar[] }) => {
  const isFinger = useMediaQuery(FINGER);
  const byUse = useMemo(() => bars.toSorted((a, b) => b.bytes - a.bytes), [bars]);
  const definition = useMemo(() => defineStorage(byUse, isFinger), [byUse, isFinger]);
  const description = `${list.format(
    byUse.map((bar) => `${bar.name} stores ${formatBytes(bar.bytes)}`),
  )}.`;
  return (
    <TouchHold>
      <VStack xstyle={styles.reach}>
        <Chart
          {...stylex.props(styles.chart)}
          definition={definition}
          height={Math.max(1, byUse.length) * 44}
          measureText={measureLabel}
          ariaLabel="Bytes stored on each backend"
          ariaDescription={description}
        />
      </VStack>
    </TouchHold>
  );
};

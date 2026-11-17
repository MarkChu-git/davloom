import {
  borderVars,
  colorVars,
  radiusVars,
  shadowVars,
  textSizeVars,
  typographyVars,
} from "@astryxdesign/core/theme/tokens.stylex";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import * as stylex from "@stylexjs/stylex";
import { areaY, barX, defineChart, dot, lineY, text, whenFocused } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { portal } from "@tanstack/charts/tooltip/portal";
import { curveMonotoneX } from "d3-shape";
import {
  backends,
  operationsByHour,
  type HourlyOperations,
  type StorageBackend,
} from "../sample-data/data";
import { formatBytes, formatCount } from "../sample-data/format";
import { failedOperations, totalOperations } from "./operations";
import { TouchHold } from "./TouchHold";

// Davloom draws in grays and keeps hues for statuses (see packages/ui/src/tokens/monochrome), so
// the charts draw in the ink of the accent on the card's surface, the theme's grays carry the axes
// and grid, and a failed hour takes the error color. The paints are the theme's own CSS variables,
// so a chart follows the color mode without being rebuilt.
const INK = colorVars["--color-accent"];
const FAILED = colorVars["--color-error"];
const SURFACE = colorVars["--color-background-card"];
const RULE = colorVars["--color-border"];
const LABEL = colorVars["--color-text-primary"];
const AXIS = colorVars["--color-text-secondary"];

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
});

const theme = {
  foreground: AXIS,
  muted: AXIS,
  grid: RULE,
  background: "transparent",
  palette: [INK],
};

const smooth = d3Curve(curveMonotoneX);

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

/** Chart text in pixels, as charts measure it: the theme's extra-small size at a 16 px root. */
const TEXT_SIZE = 12;

const narrowHours = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });
const hours = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const compact = new Intl.NumberFormat("en", { notation: "compact" });
const list = new Intl.ListFormat("en");

/**
 * An hour as a sentence names it, such as "12 hours ago". The latest one is "now", as the axis and
 * the tooltip call it, so a screen reader and the screen use one name for it.
 */
const hourAgo = (hour: HourlyOperations): string =>
  hour.hoursAgo === 0 ? "now" : hours.format(-hour.hoursAgo, "hour");

/** An hour as the axis and the tooltip name it: the latest one is "Now". */
const hourTitle = (hour: HourlyOperations): string => (hour.hoursAgo === 0 ? "Now" : hourAgo(hour));

/** Hours run left to right towards the sample clock, so the latest hour sits at zero. */
const hourPosition = (hour: HourlyOperations): number => -hour.hoursAgo;

const defineOperations = (isFinger: boolean) =>
  defineChart({
    marks: [
      areaY(operationsByHour, {
        x: hourPosition,
        y: "operations",
        fill: "url(#operations-wash)",
        curve: smooth,
      }),
      lineY(operationsByHour, {
        x: hourPosition,
        y: "operations",
        stroke: INK,
        strokeWidth: 2,
        curve: smooth,
      }),
      // A hollow ring in the error color on each hour with a failed operation, so a failure reads
      // by its shape as well as its color.
      dot(
        operationsByHour.filter((hour) => hour.failed > 0),
        { x: hourPosition, y: "operations", r: 4, fill: SURFACE, stroke: FAILED, strokeWidth: 2 },
      ),
      // One ring on the hour in focus. An hour with a failed operation keeps its error ring, which
      // another ring on top would hide.
      whenFocused(
        dot(
          operationsByHour.filter((hour) => hour.failed === 0),
          { x: hourPosition, y: "operations", r: 4, fill: SURFACE, stroke: INK, strokeWidth: 2 },
        ),
        { match: "x", retarget: true },
      ),
      crosshair({ x: { stroke: RULE }, y: false }),
    ],
    // TanStack Charts' own focus ring is off: the area, the line and the error ring each drew one on
    // the hour in focus, and the last of them, in the card's color, hid the error ring.
    focusRing: false,
    scales: {
      x: {
        scale: scaleLinear,
        axis: {
          line: false,
          ticks: {
            values: [-18, -12, -6, 0],
            line: false,
            format: (value) => (value === 0 ? "Now" : narrowHours.format(value, "hour")),
          },
          tickLabels: { fontSize: TEXT_SIZE },
        },
      },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: { stroke: RULE },
        axis: {
          line: false,
          ticks: { count: 3, line: false, format: (value) => compact.format(value) },
          tickLabels: { fontSize: TEXT_SIZE },
        },
      },
    },
    gradients: [
      {
        id: "operations-wash",
        x1: 0,
        y1: 1,
        x2: 0,
        y2: 0,
        stops: [
          { offset: 0, color: INK, opacity: 0 },
          { offset: 1, color: INK, opacity: 0.2 },
        ],
      },
    ],
    theme,
    focus: "group-x",
    maxFocusDistance: Number.POSITIVE_INFINITY,
    tooltip: {
      use: tooltip,
      ...(isFinger ? ABOVE_THE_PLOT : {}),
      content: (points) => {
        const hour = points[0]?.datum;
        if (hour === undefined) {
          return { rows: [] };
        }
        return {
          title: hourTitle(hour),
          rows: [
            { label: "Operations", value: formatCount(hour.operations) },
            ...(hour.failed > 0 ? [{ label: "Failed", value: formatCount(hour.failed) }] : []),
          ],
        };
      },
    },
  });

const operationsDefinition = defineOperations(false);
const operationsForFinger = defineOperations(true);

const busiest = operationsByHour.reduce((top, hour) =>
  hour.operations > top.operations ? hour : top,
);

// What the chart shows, in words, for assistive technology. Each hour's own figures are read by
// moving through the chart with the arrow keys.
const operationsDescription = [
  `${formatCount(totalOperations)} operations, ${formatCount(failedOperations)} of them failed`,
  failedOperations === 0
    ? "."
    : `, ${list.format(operationsByHour.filter((hour) => hour.failed > 0).map(hourAgo))}.`,
  busiest.hoursAgo === 0
    ? ` The busiest hour is now, with ${formatCount(busiest.operations)}.`
    : ` The busiest hour was ${hourAgo(busiest)}, with ${formatCount(busiest.operations)}.`,
].join("");

/** Operations per hour over the last 24 hours, with a ring on each hour where one failed. */
export const OperationsChart = () => {
  const isFinger = useMediaQuery(FINGER);
  return (
    <TouchHold>
      <Chart
        {...stylex.props(styles.chart)}
        definition={isFinger ? operationsForFinger : operationsDefinition}
        height={200}
        ariaLabel="Operations per hour, last 24 hours"
        ariaDescription={operationsDescription}
      />
    </TouchHold>
  );
};

const byUse = backends.toSorted((a, b) => b.usedBytes - a.usedBytes);
const used = (backend: StorageBackend): number => backend.usedBytes;
const name = (backend: StorageBackend): string => backend.name;
const largest = byUse[0]?.usedBytes ?? 0;

// The backend in focus keeps its bar and its size, and the others fade, which is how a bar shows
// focus. The ring that TanStack Charts draws on a focused point suits a line, and here the bar and
// its size each drew one, side by side at the tip.
const OTHERS_FADE = [{ when: { focus: "unmatched" }, style: { opacity: 0.35 } }] as const;

const defineStorage = (isFinger: boolean) =>
  defineChart({
    marks: [
      barX(byUse, {
        x: used,
        y: name,
        fill: INK,
        maxThickness: 12,
        radius: { end: 4 },
        states: OTHERS_FADE,
      }),
      // Each bar's size at its tip, in the theme's text color rather than the bar's ink.
      text(byUse, {
        x: used,
        y: name,
        text: (backend) => formatBytes(backend.usedBytes),
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
        const backend = points[0]?.datum;
        if (backend === undefined) {
          return { rows: [] };
        }
        return {
          title: backend.name,
          rows: [
            { label: "Stored", value: formatBytes(backend.usedBytes) },
            { label: "Objects", value: formatCount(backend.objectCount) },
          ],
        };
      },
    },
  });

const storageDefinition = defineStorage(false);
const storageForFinger = defineStorage(true);

const storageDescription = `${list.format(
  byUse.map((backend) => `${backend.name} stores ${formatBytes(backend.usedBytes)}`),
)}.`;

/** Bytes stored on each backend, largest first. */
export const StorageChart = () => {
  const isFinger = useMediaQuery(FINGER);
  return (
    <TouchHold>
      <Chart
        {...stylex.props(styles.chart)}
        definition={isFinger ? storageForFinger : storageDefinition}
        height={44 * byUse.length}
        ariaLabel="Bytes stored on each backend"
        ariaDescription={storageDescription}
      />
    </TouchHold>
  );
};

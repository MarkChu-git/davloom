import {
  borderVars,
  colorVars,
  radiusVars,
  shadowVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from "@astryxdesign/core/theme/tokens.stylex";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { VStack } from "@astryxdesign/core/Layout";
import * as stylex from "@stylexjs/stylex";
import {
  areaY,
  barX,
  createMark,
  defineChart,
  dot,
  lineY,
  text,
  whenFocused,
  type ChartPoint,
  type ChartTextMeasurer,
  type SceneNode,
} from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { Chart } from "@tanstack/charts/react";
import { Chart as ChartWithBody } from "@tanstack/charts/react/tooltip";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { portal } from "@tanstack/charts/tooltip/portal";
import { scaleSymlog } from "d3-scale";
import { curveMonotoneX } from "d3-shape";
import {
  backends,
  operationsByHour,
  recentErrors,
  type HourlyOperations,
  type OperationError,
  type StorageBackend,
} from "../sample-data/data";
import { formatBytes, formatCount, formatRelative } from "../sample-data/format";
import { ErrorDetails, ErrorSubject } from "./ErrorParts";
import { causeOf, glyphPaths, lanesFor, minutesAgo, nameOf, shortSpan } from "./errors";
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
    // The labels kern on every system, as their measure does. Left to the browser, Chromium on
    // Linux kerned the canvas a label was measured on but not the label, and drew Now wider than
    // its measure.
    fontKerning: "normal",
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
  // TanStack Charts leaves the whole surface to a tooltip body rendered in React, so the timeline
  // draws its own, from the tokens the other charts' tooltips take, and keeps it to a phone's width.
  errorTooltip: {
    maxInlineSize: "18rem",
    padding: spacingVars["--spacing-3"],
    backgroundColor: colorVars["--color-background-popover"],
    color: LABEL,
    borderWidth: borderVars["--border-width"],
    borderStyle: "solid",
    borderColor: RULE,
    borderRadius: radiusVars["--radius-element"],
    boxShadow: shadowVars["--shadow-med"],
  },
  // The picture on a marker belongs to it, so a pointer on the picture is on the marker.
  glyph: {
    pointerEvents: "none",
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
 * it in, with two changes. TanStack takes a label's ink, which set the longest label on the y axis
 * a side bearing out from where the card's title starts; this takes the label's advance, the box a
 * line of text fills, so the label and the title line up as two lines of text do. And it kerns the
 * label, as the chart draws it. The height stays the ink's, as TanStack measures it, so each chart
 * keeps its vertical layout. Where there is no canvas, as on a server, it estimates from the font
 * size.
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
  if ("fontKerning" in labelCanvas) {
    labelCanvas.fontKerning = "normal";
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

const GLYPH_CLASS = stylex.props(styles.glyph).className ?? "";

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

/**
 * Axis and bar labels in pixels, as TanStack Charts measures them: the theme's small size at a
 * 16 px root. The tooltip takes the theme's extra-small size instead, 10 px with a mouse and 12 px
 * where a touch screen's type scale is a step larger.
 */
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
      <VStack xstyle={styles.reach}>
        <Chart
          {...stylex.props(styles.chart)}
          definition={isFinger ? operationsForFinger : operationsDefinition}
          height={200}
          measureText={measureLabel}
          ariaLabel="Operations per hour, last 24 hours"
          ariaDescription={operationsDescription}
        />
      </VStack>
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
      <VStack xstyle={styles.reach}>
        <Chart
          {...stylex.props(styles.chart)}
          definition={isFinger ? storageForFinger : storageDefinition}
          height={44 * byUse.length}
          measureText={measureLabel}
          ariaLabel="Bytes stored on each backend"
          ariaDescription={storageDescription}
        />
      </VStack>
    </TouchHold>
  );
};

// The errors timeline. Each failed operation is a disc of the error color with the picture of its
// cause, on a stem above an axis of the last 24 hours.

/** A marker's radius: a disc 40 px wide, with room around the 24 px picture of its cause. */
const MARKER = 20;
/** The ring of the card's color around each marker. */
const RING = 2;
/** Lucide draws its icons in a box 24 units wide, which the timeline draws at 24 px. */
const GLYPH_BOX = 24;
/** The stem between the axis and the lowest marker. */
const STEM = 12;
/** The room between a marker and the one above it. */
const LANE_GAP = 6;
/** Markers stack two high where they would cover each other, which the sample errors need. */
const LANES = 2;
const LANE_STEP = 2 * MARKER + LANE_GAP;
/** The room beside the plot for half a marker on either end of the day. */
const INSET = MARKER + 4;
const TIMELINE_HEIGHT = 128;

const DISC = colorVars["--color-error-muted"];
const GLYPH = colorVars["--color-on-error-muted"];
const AXIS_LINE = colorVars["--color-border-emphasized"];

/** A day in minutes, the span of the timeline and of the Operations chart above it. */
const DAY = 24 * 60;

/**
 * Ages run left to right towards the sample clock, so the latest error sits at zero. The scale is
 * logarithmic near zero and linear through it (symlog), so the last hour, where an owner looks
 * first, takes more than half the width, and errors minutes apart stay apart.
 */
const ageScale = () => scaleSymlog().constant(1).domain([-DAY, 0]);

const AGE_TICKS = [-DAY, -6 * 60, -60, -10, 0];

const tickHours = new Intl.NumberFormat("en", {
  style: "unit",
  unit: "hour",
  unitDisplay: "narrow",
});

/** A tick as short as it gets: "24h", "6h", "1h", "10m" and "Now", as the axis above says hours. */
const ageTick = (value: number): string => {
  if (value === 0) {
    return "Now";
  }
  return value <= -60 ? tickHours.format(-value / 60) : shortSpan(-value);
};

const lastDay = recentErrors.filter((error) => minutesAgo(error.at) <= DAY);
const agePosition = (error: OperationError): number => -minutesAgo(error.at);

/** The paths of each cause's picture, worked out once. */
const glyphsOf = new Map(lastDay.map((error) => [error.id, glyphPaths(causeOf(error).glyph)]));

const errorMarkers = createMark<OperationError, number, number>(({ markIndex }) => {
  const id = `errors-${markIndex}`;
  return {
    id,
    channels: { x: { scale: "x", values: lastDay.map(agePosition) } },
    render: ({ chart, scales }) => {
      const x = scales["x"];
      if (x === undefined) {
        return { nodes: [] };
      }
      const axis = chart.y + chart.height;
      const centers = lastDay.map((error) => x.map(agePosition(error)));
      const lanes = lanesFor(centers, LANE_STEP, LANES);
      const heightOf = (index: number): number =>
        axis - STEM - MARKER - (lanes[index] ?? 0) * LANE_STEP;
      // Every stem lies under every marker, so a stem rising to the upper lane passes behind a
      // marker on the lower one rather than across its picture.
      const stems = lastDay.map((error, index): SceneNode => ({
        kind: "rule",
        key: `${id}:${error.id}:stem`,
        x1: centers[index] ?? 0,
        y1: axis,
        x2: centers[index] ?? 0,
        y2: heightOf(index) + MARKER,
        ariaHidden: true,
        style: { stroke: AXIS_LINE, strokeWidth: 1 },
      }));
      const markers: SceneNode[] = lastDay.flatMap((error, index): SceneNode[] => {
        const cx = centers[index] ?? 0;
        const cy = heightOf(index);
        const key = `${id}:${error.id}`;
        const point: ChartPoint<OperationError, number, number> = {
          key,
          markId: id,
          group: null,
          groupLabel: id,
          datum: error,
          datumIndex: index,
          xValue: agePosition(error),
          yValue: lanes[index] ?? 0,
          x: cx,
          y: cy,
          color: GLYPH,
        };
        return [
          {
            // The card's color under the marker and its ring hides a stem behind it, which the
            // error color's muted shade lets through where it is translucent, as in dark mode.
            kind: "dot",
            key: `${key}:base`,
            x: cx,
            y: cy,
            radius: MARKER + RING / 2,
            ariaHidden: true,
            style: { fill: SURFACE },
          },
          {
            kind: "dot",
            key,
            x: cx,
            y: cy,
            radius: MARKER,
            interaction: { point },
            // A ring of the card's color keeps markers apart where they come close.
            style: { fill: DISC, stroke: SURFACE, strokeWidth: RING },
          },
          {
            kind: "group",
            key: `${key}:glyph`,
            className: GLYPH_CLASS,
            translateX: cx - GLYPH_BOX / 2,
            translateY: cy - GLYPH_BOX / 2,
            ariaHidden: true,
            children: (glyphsOf.get(error.id) ?? []).map((path, part): SceneNode => ({
              kind: "polyline",
              key: `${key}:glyph:${part}`,
              points: [],
              path,
              style: {
                fill: "none",
                stroke: GLYPH,
                strokeWidth: 2,
                lineCap: "round",
                lineJoin: "round",
              },
            })),
          },
        ];
      });
      return {
        nodes: [
          {
            kind: "group",
            key: id,
            ariaHidden: true,
            children: [
              {
                kind: "rule",
                key: `${id}:axis`,
                // The axis runs the panel's whole width, from the title's line, while the scale
                // keeps half a marker inside each end of the day.
                x1: chart.x - INSET,
                y1: axis,
                x2: chart.x + chart.width + INSET,
                y2: axis,
                style: { stroke: AXIS_LINE, strokeWidth: 1 },
              },
              ...stems,
              ...markers,
            ],
          },
        ],
      };
    },
  };
});

const errorRows = (error: OperationError) => [
  { label: "Status", value: `${error.status} ${causeOf(error).label}` },
  { label: "Request", value: `${error.method} ${error.path}` },
  { label: "Reason", value: error.message },
  { label: "When", value: formatRelative(error.at) },
];

const defineErrorTimeline = (isFinger: boolean) =>
  defineChart({
    marks: [errorMarkers],
    scales: {
      x: {
        scale: ageScale(),
        axis: {
          line: false,
          ticks: {
            values: AGE_TICKS,
            line: false,
            format: ageTick,
          },
          tickLabels: { fontSize: TEXT_SIZE },
        },
      },
      // The markers stack in pixels above the axis, so the vertical scale only spans the plot.
      y: { scale: scaleLinear().domain([0, 1]), axis: false },
    },
    margin: { top: 4, left: INSET, right: INSET },
    theme,
    focus: "nearest",
    // A pointer shows an error once it is on its marker; a finger, which covers what it holds,
    // once it is near it.
    maxFocusDistance: isFinger ? 2 * MARKER : MARKER + 4,
    focusRing: { radius: MARKER + 4, fill: "none", stroke: INK, strokeWidth: 2 },
    // The details show above the plot for every pointer: the timeline ends the page, so there is
    // no room below it, and beside a marker they would cover its neighbors.
    tooltip: {
      use: tooltip,
      ...ABOVE_THE_PLOT,
      content: (points) => {
        const error = points[0]?.datum;
        return error === undefined
          ? { rows: [] }
          : { title: nameOf(error), rows: errorRows(error) };
      },
    },
  });

const timelineDefinition = defineErrorTimeline(false);
const timelineForFinger = defineErrorTimeline(true);

// What the timeline shows, in words, for assistive technology: each error's file, cause and age,
// oldest first, as the markers run from left to right.
const timelineDescription = [
  `${formatCount(lastDay.length)} ${lastDay.length === 1 ? "operation" : "operations"} failed in the last 24 hours.`,
  ...lastDay
    .toSorted((first, second) => agePosition(first) - agePosition(second))
    .map(
      (error) =>
        `${nameOf(error)}: ${causeOf(error).label.toLowerCase()}, ${formatRelative(error.at)}.`,
    ),
].join(" ");

/** The recent operation errors along the last 24 hours, each a marker of its cause. */
export const ErrorTimeline = () => {
  const isFinger = useMediaQuery(FINGER);
  return (
    <TouchHold>
      <ChartWithBody
        {...stylex.props(styles.chart)}
        definition={isFinger ? timelineForFinger : timelineDefinition}
        height={TIMELINE_HEIGHT}
        ariaLabel="Operation errors, last 24 hours"
        ariaDescription={timelineDescription}
        renderTooltipBody={({ primaryPoint }) =>
          primaryPoint === undefined ? null : (
            <VStack gap={3} xstyle={styles.errorTooltip}>
              <ErrorSubject error={primaryPoint.datum} />
              <ErrorDetails error={primaryPoint.datum} />
            </VStack>
          )
        }
      />
    </TouchHold>
  );
};

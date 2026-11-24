import { Skeleton } from "@astryxdesign/core/Skeleton";
import { type ComponentProps, lazy, Suspense } from "react";
import { BAR_HEIGHT, OPERATIONS_HEIGHT, TIMELINE_HEIGHT } from "./chartHeights";
import type * as Charts from "./charts";

/**
 * The Overview's charts, loaded apart from the page. The charting code is most of the page's code,
 * so the page's first render does not wait for it or run it: the download starts with the page,
 * and each chart takes the place of a placeholder of its own height once its code has arrived, in
 * a task of its own.
 */
const charts = import.meta.env.SSR ? undefined : import("./charts");
const load = () => charts ?? import("./charts");

const LazyOperations = lazy(() => load().then((module) => ({ default: module.OperationsChart })));
const LazyStorage = lazy(() => load().then((module) => ({ default: module.StorageChart })));
const LazyTimeline = lazy(() => load().then((module) => ({ default: module.ErrorTimeline })));

export const OperationsChart = (props: ComponentProps<typeof Charts.OperationsChart>) => (
  <Suspense fallback={<Skeleton width="100%" height={OPERATIONS_HEIGHT} />}>
    <LazyOperations {...props} />
  </Suspense>
);

export const StorageChart = (props: ComponentProps<typeof Charts.StorageChart>) => (
  <Suspense
    fallback={<Skeleton width="100%" height={Math.max(1, props.bars.length) * BAR_HEIGHT} />}
  >
    <LazyStorage {...props} />
  </Suspense>
);

export const ErrorTimeline = (props: ComponentProps<typeof Charts.ErrorTimeline>) => (
  <Suspense fallback={<Skeleton width="100%" height={TIMELINE_HEIGHT} />}>
    <LazyTimeline {...props} />
  </Suspense>
);

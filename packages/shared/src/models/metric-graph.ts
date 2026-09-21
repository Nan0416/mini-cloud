import { MetricDimensions, MetricStatistic } from './metric';

/**
 * A metric graph as JSON: what the metrics page shows, what a shared link carries, and
 * what a dashboard widget will store.
 *
 * Shaped like a CloudWatch `GetMetricData` query, with named fields, rather than like
 * CloudWatch's dashboard JSON, whose positional arrays cannot be typed or validated
 * field by field.
 */

export const METRIC_GRAPH_VERSION = 1;

/**
 * Series colours the console has: eight that stay distinct under colour-blindness.
 * Reusing one would make two series look like one, so it also caps a graph's queries.
 */
const SERIES_COLORS = 8;

export const METRIC_GRAPH_LIMITS = {
  queries: SERIES_COLORS,
  colors: SERIES_COLORS,
  /** CloudWatch's limit on a query `Id`. */
  idLength: 255,
} as const;

export type MetricAxis = 'left' | 'right';

export const METRIC_AXES: ReadonlyArray<MetricAxis> = ['left', 'right'];

/** One series on a graph. */
export interface MetricQuery {
  /**
   * Unique within the graph, and kept across edits, so a series keeps its colour and
   * legend entry when another is removed. It follows CloudWatch's `Id` rules so it can
   * later name the series in an expression.
   */
  readonly id: string;
  readonly namespace: string;
  readonly metricName: string;
  /** The exact set, as `GetMetricDataRequest` requires. Never a subset. */
  readonly dimensions: MetricDimensions;
  readonly statistic: MetricStatistic;
  /** Legend text. Absent means one is built from the metric and its dimensions. */
  readonly label?: string;
  /**
   * Which of the series colours, 1 to 8. Kept with the query so removing another series
   * does not repaint this one. Absent means the first colour no other query holds.
   */
  readonly color?: number;
  /** Absent means left. */
  readonly yAxis?: MetricAxis;
}

/** The last `durationMs`, which moves with the clock on every poll. */
export interface RelativeTimeRange {
  readonly kind: 'relative';
  readonly durationMs: number;
}

/** A fixed window in milliseconds since the epoch. `to` is exclusive. */
export interface AbsoluteTimeRange {
  readonly kind: 'absolute';
  readonly from: number;
  readonly to: number;
}

export type MetricTimeRange = RelativeTimeRange | AbsoluteTimeRange;

export const METRIC_TIME_RANGE_KINDS: ReadonlyArray<MetricTimeRange['kind']> = ['relative', 'absolute'];

export interface MetricGraph {
  /** Changes whenever an older reader would misread the document. */
  readonly version: typeof METRIC_GRAPH_VERSION;
  readonly queries: ReadonlyArray<MetricQuery>;
  readonly range: MetricTimeRange;
  /**
   * One bucket width for every series, so the hover crosshair lands on the same
   * instant in each. A whole number of minutes; absent means `autoPeriodFor` the range.
   */
  readonly periodMs?: number;
}

import {
  METRIC_AXES,
  METRIC_GRAPH_LIMITS,
  METRIC_GRAPH_VERSION,
  METRIC_MAX_DATAPOINTS,
  spanOf,
  type MetricAxis,
  type MetricGraph,
  type MetricQuery,
  type MetricTimeRange,
  type MetricUnit,
} from '@mini-cloud/shared';
import { conversionFactor } from '@/lib/metric-units';

/** The rules the metrics page edits a graph by, kept apart from the page so they can be tested. */

const HOUR_MS = 3_600_000;

/** Where a new graph starts: no series, and CloudWatch's default window. */
export const EMPTY_GRAPH: MetricGraph = { version: METRIC_GRAPH_VERSION, queries: [], range: { kind: 'relative', durationMs: 3 * HOUR_MS } };

/** The first `m<n>` no query has, so ids stay short and read in the order they were added. */
export function nextQueryId(queries: ReadonlyArray<MetricQuery>): string {
  const taken = new Set(queries.map((query) => query.id));
  let candidate = 1;
  while (taken.has(`m${candidate}`)) {
    candidate += 1;
  }
  return `m${candidate}`;
}

/**
 * Each query's colour: its own when it has one, otherwise the first nobody holds.
 * Never cycled, because a graph has no more queries than there are colours.
 */
export function colorsOf(queries: ReadonlyArray<MetricQuery>): ReadonlyArray<number> {
  const taken = new Set(queries.flatMap((query) => (query.color === undefined ? [] : [query.color])));
  return queries.map((query) => {
    if (query.color !== undefined) {
      return query.color;
    }
    let candidate = 1;
    while (taken.has(candidate) && candidate < METRIC_GRAPH_LIMITS.colors) {
      candidate += 1;
    }
    taken.add(candidate);
    return candidate;
  });
}

/** The colour a new query is given, written into it so it keeps that colour. */
export function nextColor(queries: ReadonlyArray<MetricQuery>): number {
  const taken = new Set(colorsOf(queries));
  let candidate = 1;
  while (taken.has(candidate) && candidate < METRIC_GRAPH_LIMITS.colors) {
    candidate += 1;
  }
  return candidate;
}

/** "CpuUtilization · nas · p99": the metric, its dimension values, and the statistic. */
export function labelOf(query: MetricQuery): string {
  return query.label ?? [query.metricName, ...Object.values(query.dimensions), query.statistic].join(' · ');
}

export type AxisUnits = Readonly<Record<MetricAxis, ReadonlyArray<MetricUnit>>>;

export interface PlacedUnit {
  readonly axis: MetricAxis;
  readonly unit: MetricUnit;
}

/** The kinds of unit on each axis, one entry per group that converts into itself, as the chart groups them. */
export function axisUnitsOf(placed: ReadonlyArray<PlacedUnit>): AxisUnits {
  const units: Record<MetricAxis, MetricUnit[]> = { left: [], right: [] };
  for (const { axis, unit } of placed) {
    if (!units[axis].some((existing) => conversionFactor(unit, existing) !== undefined)) {
      units[axis].push(unit);
    }
  }
  return units;
}

/** Whether a series in `unit` can be read against `axis` without mixing its scale. */
export function axisAccepts(unit: MetricUnit, axis: MetricAxis, units: AxisUnits): boolean {
  return units[axis].every((existing) => conversionFactor(unit, existing) !== undefined);
}

/**
 * The axis a new series in `unit` belongs on: the one already holding its kind of
 * unit, else an empty one, left first. `undefined` when both hold other units, since a
 * third would have no scale to be read against.
 */
export function axisFor(unit: MetricUnit, units: AxisUnits): MetricAxis | undefined {
  return METRIC_AXES.find((axis) => units[axis].length > 0 && axisAccepts(unit, axis, units)) ?? METRIC_AXES.find((axis) => units[axis].length === 0);
}

/** Whether `periodMs` keeps a span within what one read may return. */
export function periodFits(spanMs: number, periodMs: number): boolean {
  return Math.ceil(spanMs / periodMs) <= METRIC_MAX_DATAPOINTS;
}

/**
 * The graph over a new range. A chosen period the new range outgrows is dropped, so the
 * graph falls back to the automatic one instead of every series being refused.
 */
export function withRange(graph: MetricGraph, range: MetricTimeRange): MetricGraph {
  const keepPeriod = graph.periodMs !== undefined && periodFits(spanOf(range), graph.periodMs);
  return { ...graph, range, periodMs: keepPeriod ? graph.periodMs : undefined };
}

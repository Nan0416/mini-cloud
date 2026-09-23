import {
  METRIC_AXES,
  METRIC_RESOLUTION_MS,
  METRIC_GRAPH_LIMITS,
  METRIC_GRAPH_VERSION,
  METRIC_MAX_DATAPOINTS,
  metricIdentity,
  seriesIdentity,
  spanOf,
  type MetricAxis,
  type MetricDimensions,
  type MetricGraph,
  type MetricQuery,
  type MetricTimeRange,
  type MetricUnit,
} from '@mini-cloud/shared';
import { conversionFactor } from '@/lib/metric-units';

/** The rules the metrics page edits a graph by, kept apart from the page so they can be tested. */

/** Where a new graph starts: no series, and CloudWatch's default window. */
export const EMPTY_GRAPH: MetricGraph = { version: METRIC_GRAPH_VERSION, queries: [], range: { kind: 'relative', durationMs: 3 * METRIC_RESOLUTION_MS['1h'] } };

/** The first `m<n>` no query has, so ids stay short and read in the order they were added. */
export function nextQueryId(queries: ReadonlyArray<MetricQuery>): string {
  const taken = new Set(queries.map((query) => query.id));
  let candidate = 1;
  while (taken.has(`m${candidate}`)) {
    candidate += 1;
  }
  return `m${candidate}`;
}

/** The first colour not in `taken`. Never cycled, because a graph has no more queries than colours. */
function firstFreeColor(taken: ReadonlySet<number>): number {
  let candidate = 1;
  while (taken.has(candidate) && candidate < METRIC_GRAPH_LIMITS.colors) {
    candidate += 1;
  }
  return candidate;
}

/** Each query's colour: its own when it has one, otherwise the first nobody holds. */
export function colorsOf(queries: ReadonlyArray<MetricQuery>): ReadonlyArray<number> {
  const taken = new Set(queries.flatMap((query) => (query.color === undefined ? [] : [query.color])));
  return queries.map((query) => {
    if (query.color !== undefined) {
      return query.color;
    }
    const color = firstFreeColor(taken);
    taken.add(color);
    return color;
  });
}

/** The colour a new query is given, written into it so it keeps that colour. */
export function nextColor(queries: ReadonlyArray<MetricQuery>): number {
  return firstFreeColor(new Set(colorsOf(queries)));
}

/** How a dimension set reads in a picker or a row. The empty set is a series too. */
export function describeDimensions(dimensions: MetricDimensions): string {
  const entries = Object.entries(dimensions);
  if (entries.length === 0) {
    return 'No dimensions';
  }
  return entries.map(([name, value]) => `${name}=${value}`).join(', ');
}

/** Whether two queries read the same metric and dimension set, whatever statistic each takes. */
export function isSameMetric(left: MetricQuery, right: MetricQuery): boolean {
  return metricIdentity(left) === metricIdentity(right);
}

/** Whether two queries read the same series, and so would draw one line twice. */
export function isSameSeries(left: MetricQuery, right: MetricQuery): boolean {
  return seriesIdentity(left) === seriesIdentity(right);
}

/** Whether `candidate` would read a series the graph already has. */
export function isOnGraph(queries: ReadonlyArray<MetricQuery>, candidate: MetricQuery): boolean {
  return queries.some((query) => isSameSeries(query, candidate));
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

/**
 * Why a period cannot be read over a span, or `undefined` when it can. Too fine is more
 * datapoints than one read may return; too coarse is not one whole bucket in the range.
 */
export function periodProblem(spanMs: number, periodMs: number): 'too many points' | 'longer than the range' | undefined {
  if (periodMs > spanMs) {
    return 'longer than the range';
  }
  if (Math.ceil(spanMs / periodMs) > METRIC_MAX_DATAPOINTS) {
    return 'too many points';
  }
  return undefined;
}

export function periodFits(spanMs: number, periodMs: number): boolean {
  return periodProblem(spanMs, periodMs) === undefined;
}

/**
 * The graph over a new range. A chosen period the new range outgrows is dropped, so the
 * graph falls back to the automatic one instead of every series being refused.
 */
export function withRange(graph: MetricGraph, range: MetricTimeRange): MetricGraph {
  const keepPeriod = graph.periodMs !== undefined && periodFits(spanOf(range), graph.periodMs);
  return { ...graph, range, periodMs: keepPeriod ? graph.periodMs : undefined };
}

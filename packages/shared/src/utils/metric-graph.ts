import { InvalidRequestError } from '../errors';
import { METRIC_RESOLUTION_MS, METRIC_STATISTICS } from '../models/metric';
import { METRIC_AXES, METRIC_GRAPH_LIMITS, METRIC_GRAPH_VERSION, METRIC_TIME_RANGE_KINDS, MetricGraph, MetricQuery, MetricTimeRange } from '../models/metric-graph';
import {
  assertArray,
  assertInteger,
  assertNonEmptyString,
  assertOneOf,
  assertOptionalInteger,
  assertOptionalOneOf,
  assertOptionalString,
  assertRecord,
  assertStringMap,
  assertTimestamp,
} from './assertions';
import { hashDimensions } from './dimensions';

const MINUTE_MS = METRIC_RESOLUTION_MS['1m'];
const DAY_MS = METRIC_RESOLUTION_MS['1d'];

/** CloudWatch's rule for a query `Id`: something an expression can name. */
const QUERY_ID = /^[a-z][a-zA-Z0-9_]*$/;

const GRAPH_KEYS = ['version', 'queries', 'range', 'periodMs'];
const QUERY_KEYS = ['id', 'namespace', 'metricName', 'dimensions', 'statistic', 'label', 'color', 'yAxis'];
const RELATIVE_KEYS = ['kind', 'durationMs'];
const ABSOLUTE_KEYS = ['kind', 'from', 'to'];

/**
 * A misspelt optional field, `lable` for `label`, would otherwise be dropped without a
 * word, and the legend would show the default for no visible reason.
 */
function assertKnownKeys(record: Record<string, unknown>, field: string, known: ReadonlyArray<string>): void {
  for (const key of Object.keys(record)) {
    if (!known.includes(key)) {
      throw new InvalidRequestError(`${field}.${key} is not a field of a metric graph; ${field} may have ${known.join(', ')}`);
    }
  }
}

function parseTimeRange(value: unknown, field: string): MetricTimeRange {
  const record = assertRecord(value, field);
  const kind = assertOneOf(record['kind'], `${field}.kind`, METRIC_TIME_RANGE_KINDS);

  if (kind === 'relative') {
    assertKnownKeys(record, field, RELATIVE_KEYS);
    const durationMs = assertTimestamp(record['durationMs'], `${field}.durationMs`);
    if (durationMs <= 0) {
      throw new InvalidRequestError(`${field}.durationMs must be positive`);
    }
    return { kind, durationMs };
  }

  assertKnownKeys(record, field, ABSOLUTE_KEYS);
  const from = assertTimestamp(record['from'], `${field}.from`);
  const to = assertTimestamp(record['to'], `${field}.to`);
  if (from >= to) {
    throw new InvalidRequestError(`${field}.from must be before ${field}.to`);
  }
  return { kind, from, to };
}

function parseQuery(value: unknown, field: string): MetricQuery {
  const record = assertRecord(value, field);
  assertKnownKeys(record, field, QUERY_KEYS);

  const id = assertNonEmptyString(record['id'], `${field}.id`);
  if (id.length > METRIC_GRAPH_LIMITS.idLength || !QUERY_ID.test(id)) {
    throw new InvalidRequestError(
      `${field}.id must start with a lowercase letter and hold only letters, digits and underscores, up to ${METRIC_GRAPH_LIMITS.idLength} characters, like "m1"`,
    );
  }

  const label = assertOptionalString(record['label'], `${field}.label`);
  if (label !== undefined && label.length === 0) {
    throw new InvalidRequestError(`${field}.label must not be empty; leave it out for the default`);
  }

  const color = assertOptionalInteger(record['color'], `${field}.color`);
  if (color !== undefined && (color < 1 || color > METRIC_GRAPH_LIMITS.colors)) {
    throw new InvalidRequestError(`${field}.color must be a series colour from 1 to ${METRIC_GRAPH_LIMITS.colors}`);
  }

  return {
    id,
    namespace: assertNonEmptyString(record['namespace'], `${field}.namespace`),
    metricName: assertNonEmptyString(record['metricName'], `${field}.metricName`),
    dimensions: assertStringMap(record['dimensions'], `${field}.dimensions`),
    statistic: assertOneOf(record['statistic'], `${field}.statistic`, METRIC_STATISTICS),
    label,
    color,
    yAxis: assertOptionalOneOf(record['yAxis'], `${field}.yAxis`, METRIC_AXES),
  };
}

function parsePeriod(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const periodMs = assertInteger(value, field);
  if (periodMs <= 0 || periodMs % MINUTE_MS !== 0) {
    throw new InvalidRequestError(`${field} must be a whole number of minutes in milliseconds, like 300000 for five minutes`);
  }
  return periodMs;
}

/** Which metric and dimension set a query reads, whatever statistic it takes of them. */
export function metricIdentity(query: MetricQuery): string {
  return JSON.stringify([query.namespace, query.metricName, hashDimensions(query.dimensions)]);
}

/**
 * What a query reads, apart from how it is drawn: two queries with the same identity are
 * the same request and would plot the same line twice.
 */
export function seriesIdentity(query: MetricQuery): string {
  return JSON.stringify([metricIdentity(query), query.statistic]);
}

/**
 * Checks a graph that arrived from anywhere — a link, a file, a request body — and
 * returns it with nothing but the fields the format defines.
 *
 * It checks shape, not whether the graph can be answered: a period too fine for its
 * range is refused by the service per series, where the chart can say which one.
 */
export function parseMetricGraph(value: unknown): MetricGraph {
  const record = assertRecord(value, 'graph');
  // Before the keys, because a newer version is the likelier reason for a field this
  // reader does not know.
  if (record['version'] !== METRIC_GRAPH_VERSION) {
    throw new InvalidRequestError(`graph.version must be ${METRIC_GRAPH_VERSION}, the only graph format this version of mini-cloud reads`);
  }
  assertKnownKeys(record, 'graph', GRAPH_KEYS);

  const entries = assertArray(record['queries'], 'graph.queries');
  if (entries.length > METRIC_GRAPH_LIMITS.queries) {
    throw new InvalidRequestError(`graph.queries has ${entries.length} entries, more than the ${METRIC_GRAPH_LIMITS.queries} one graph may plot`);
  }

  const ids = new Set<string>();
  const colors = new Set<number>();
  const series = new Map<string, number>();
  const queries = entries.map((entry, index) => {
    const query = parseQuery(entry, `graph.queries[${index}]`);
    if (ids.has(query.id)) {
      throw new InvalidRequestError(`graph.queries[${index}].id "${query.id}" is already used by an earlier query; each needs its own`);
    }
    ids.add(query.id);
    // Two lines in one colour read as one series.
    if (query.color !== undefined && colors.has(query.color)) {
      throw new InvalidRequestError(`graph.queries[${index}].color ${query.color} is already used by an earlier query; each needs its own, or leave it out to be given a free one`);
    }
    if (query.color !== undefined) {
      colors.add(query.color);
    }
    const earlier = series.get(seriesIdentity(query));
    if (earlier !== undefined) {
      throw new InvalidRequestError(`graph.queries[${index}] reads the same series as graph.queries[${earlier}]; change its statistic or dimensions, or remove it`);
    }
    series.set(seriesIdentity(query), index);
    return query;
  });

  return {
    version: METRIC_GRAPH_VERSION,
    queries,
    range: parseTimeRange(record['range'], 'graph.range'),
    periodMs: parsePeriod(record['periodMs'], 'graph.periodMs'),
  };
}

/**
 * Candidate periods, finest first. From an hour up each divides a day, so buckets line
 * up with the hourly and daily rollups and are read from them rather than from minutes.
 */
const AUTO_PERIODS_MS = [1, 5, 15, 60, 180, 360, 720, 1440].map((minutes) => minutes * MINUTE_MS);

/**
 * About as many points as a chart the width of the console can draw distinctly, and
 * well inside `METRIC_MAX_DATAPOINTS`.
 */
const AUTO_PERIOD_POINTS = 500;

/** The finest period that keeps a range within `AUTO_PERIOD_POINTS`. */
export function autoPeriodFor(spanMs: number): number {
  const fits = AUTO_PERIODS_MS.find((periodMs) => Math.ceil(spanMs / periodMs) <= AUTO_PERIOD_POINTS);
  if (fits !== undefined) {
    return fits;
  }
  // Whole days past the last candidate, so the daily rollup still answers.
  return Math.ceil(spanMs / AUTO_PERIOD_POINTS / DAY_MS) * DAY_MS;
}

export function spanOf(range: MetricTimeRange): number {
  return range.kind === 'relative' ? range.durationMs : range.to - range.from;
}

/** The period a graph is read at: its own, or the automatic one for its range. */
export function periodOf(graph: MetricGraph): number {
  return graph.periodMs ?? autoPeriodFor(spanOf(graph.range));
}

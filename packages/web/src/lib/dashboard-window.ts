import { InvalidRequestError, METRIC_RESOLUTION_MS, assertTimestamp, spanOf, type Dashboard, type MetricTimeRange } from '@mini-cloud/shared';
import { EMPTY_GRAPH, periodFits } from '@/lib/metric-graph-editor';

/**
 * The window a dashboard is shown over, as its link carries it.
 *
 * Readable parameters rather than the metrics page's opaque graph: a window is two or
 * three scalars, and `?range=3h&period=5m` is a link someone can read and edit by hand.
 */
export interface DashboardWindow {
  readonly range: MetricTimeRange;
  /** Absent means the automatic period for the range. */
  readonly periodMs?: number;
}

const RANGE_PARAM = 'range';
const FROM_PARAM = 'from';
const TO_PARAM = 'to';
const PERIOD_PARAM = 'period';

const SPAN_UNITS: ReadonlyArray<readonly [string, number]> = [
  ['w', 7 * METRIC_RESOLUTION_MS['1d']],
  ['d', METRIC_RESOLUTION_MS['1d']],
  ['h', METRIC_RESOLUTION_MS['1h']],
  ['m', METRIC_RESOLUTION_MS['1m']],
];

const SPAN = /^(\d+)([mhdw])$/;

/** "3h", "90m", "2w": in the largest unit that divides it, never finer than a minute. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / METRIC_RESOLUTION_MS['1m'])) * METRIC_RESOLUTION_MS['1m'];
  const [unit, size] = SPAN_UNITS.find(([, candidate]) => minutes % candidate === 0) ?? ['m', METRIC_RESOLUTION_MS['1m']];
  return `${minutes / size}${unit}`;
}

export function parseSpan(text: string, field: string): number {
  const match = SPAN.exec(text);
  const size = match === null ? undefined : SPAN_UNITS.find(([unit]) => unit === match[2])?.[1];
  const count = match === null ? 0 : Number(match[1]);
  if (size === undefined || count <= 0) {
    throw new InvalidRequestError(`${field} "${text}" is not a span; write a whole number and one of m, h, d or w, like 3h`);
  }
  return count * size;
}

function parseTime(text: string, field: string): number {
  // ISO 8601 in a link, since that is what a person can read; a number is accepted too.
  const ms = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
  if (Number.isNaN(ms)) {
    throw new InvalidRequestError(`${field} "${text}" is not a time; write it like 2026-09-01T12:00Z`);
  }
  return assertTimestamp(ms, field);
}

/** Where a dashboard opens when its link names no window. */
export function defaultWindowOf(dashboard: Dashboard): DashboardWindow {
  return { range: dashboard.defaultRange ?? EMPTY_GRAPH.range, periodMs: dashboard.defaultPeriodMs };
}

/**
 * The window a link asks for, parameter by parameter over the dashboard's default, so
 * `?period=1h` alone keeps the default range. Throws on a parameter it cannot read
 * rather than quietly showing a window nobody asked for.
 */
export function readWindow(params: URLSearchParams, fallback: DashboardWindow): DashboardWindow {
  const rangeText = params.get(RANGE_PARAM);
  const fromText = params.get(FROM_PARAM);
  const toText = params.get(TO_PARAM);
  const periodText = params.get(PERIOD_PARAM);

  let range = fallback.range;
  if (fromText !== null || toText !== null) {
    if (fromText === null || toText === null) {
      throw new InvalidRequestError('A link with from needs to as well, and the other way round');
    }
    const from = parseTime(fromText, FROM_PARAM);
    const to = parseTime(toText, TO_PARAM);
    if (from >= to) {
      throw new InvalidRequestError('from must be before to');
    }
    range = { kind: 'absolute', from, to };
  } else if (rangeText !== null) {
    range = { kind: 'relative', durationMs: parseSpan(rangeText, RANGE_PARAM) };
  }

  let periodMs = fallback.periodMs;
  if (periodText === 'auto') {
    periodMs = undefined;
  } else if (periodText !== null) {
    periodMs = parseSpan(periodText, PERIOD_PARAM);
  }
  return { range, periodMs };
}

/**
 * The query string for a window, written in full so a shared link shows the same window
 * even after the dashboard's default changes.
 */
export function windowSearch(window: DashboardWindow): string {
  const parts =
    window.range.kind === 'relative'
      ? [`${RANGE_PARAM}=${formatSpan(window.range.durationMs)}`]
      : [`${FROM_PARAM}=${new Date(window.range.from).toISOString()}`, `${TO_PARAM}=${new Date(window.range.to).toISOString()}`];
  parts.push(`${PERIOD_PARAM}=${window.periodMs === undefined ? 'auto' : formatSpan(window.periodMs)}`);
  // Nothing here needs escaping: spans are alphanumeric, and ':' is legal in a query.
  return parts.join('&');
}

export function isSameWindow(left: DashboardWindow, right: DashboardWindow): boolean {
  return windowSearch(left) === windowSearch(right);
}

/** A new range, dropping a chosen period that no longer fits in it, as the metrics page does. */
export function withWindowRange(window: DashboardWindow, range: MetricTimeRange): DashboardWindow {
  const keepPeriod = window.periodMs !== undefined && periodFits(spanOf(range), window.periodMs);
  return { range, periodMs: keepPeriod ? window.periodMs : undefined };
}

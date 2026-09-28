import {
  COMPARISON_SYMBOLS,
  METRIC_GRAPH_VERSION,
  METRIC_RESOLUTION_MS,
  MONITOR_LIMITS,
  hashDimensions,
  parseDimensionsHash,
  parseMonitorDefinition,
  type MetricGraph,
  type MetricStatistic,
  type MonitorComparison,
  type MonitorDefinition,
  type MonitorMetric,
  type TreatMissingData,
} from '@mini-cloud/shared';
import { formatDuration } from '@/lib/format';
import type { GraphWindow } from '@/lib/graph-window';
import { describeDimensions } from '@/lib/metric-graph-editor';

/** The rules the monitor pages are built on, kept apart from them so they can be tested. */

const { '1m': MINUTE, '1h': HOUR, '1d': DAY } = METRIC_RESOLUTION_MS;

/** The periods a monitor can be given. Each divides a day, so a window of them lines up with the rollups. */
export const MONITOR_PERIODS: ReadonlyArray<number> = [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR, 6 * HOUR, DAY];

export const COMPARISON_LABELS: Readonly<Record<MonitorComparison, string>> = {
  GreaterThanThreshold: 'Greater than',
  GreaterThanOrEqualToThreshold: 'Greater than or equal to',
  LessThanThreshold: 'Less than',
  LessThanOrEqualToThreshold: 'Less than or equal to',
};

export const TREAT_MISSING_DATA_LABELS: Readonly<Record<TreatMissingData, { readonly label: string; readonly description: string }>> = {
  missing: { label: 'Missing', description: 'Not counted. With no data in the whole window the monitor has insufficient data.' },
  ignore: { label: 'Ignore', description: 'Not counted. With no data in the whole window the monitor keeps its state.' },
  breaching: { label: 'Breaching', description: 'Counted as a breach, so a series that stops reporting alarms.' },
  notBreaching: { label: 'Not breaching', description: 'Counted as fine, so a series that stops reporting is OK.' },
};

/** "CpuUtilization · AgentId=nas" */
export function describeMetric(metric: MonitorMetric): string {
  const dimensions = Object.keys(metric.dimensions).length === 0 ? '' : ` · ${describeDimensions(metric.dimensions)}`;
  return `${metric.metricName}${dimensions}`;
}

/** "p99 > 80 for 3 of 5 periods of 5 minutes" */
export function describeCondition(definition: MonitorDefinition): string {
  const { statistic } = definition.metric;
  const period = formatDuration(definition.periodMs);
  const { evaluationPeriods: n, datapointsToAlarm: m } = definition;
  const span = n === 1 ? `1 period of ${period}` : m === n ? `all ${n} periods of ${period}` : `${m} of ${n} periods of ${period}`;
  return `${statistic} ${COMPARISON_SYMBOLS[definition.comparison]} ${definition.threshold} for ${span}`;
}

/**
 * Where a monitor's graph opens: at its own period, over enough of them to see the
 * evaluation window in context, and never less than the metrics page's three hours.
 */
export function defaultMonitorWindow(definition: Pick<MonitorDefinition, 'periodMs' | 'evaluationPeriods'>): GraphWindow {
  const durationMs = Math.min(7 * DAY, Math.max(3 * HOUR, 20 * definition.evaluationPeriods * definition.periodMs));
  return { range: { kind: 'relative', durationMs }, periodMs: definition.periodMs };
}

/** The monitored series as a one-query graph, drawn as the metrics page would draw it. */
export function monitorGraph(metric: MonitorMetric, window: GraphWindow): MetricGraph {
  return {
    version: METRIC_GRAPH_VERSION,
    queries: [{ id: 'm1', namespace: metric.namespace, metricName: metric.metricName, dimensions: metric.dimensions, statistic: metric.statistic, color: 1 }],
    range: window.range,
    periodMs: window.periodMs,
  };
}

/** What the form holds: numbers as typed, so a half-typed "8." is not rewritten under the cursor. */
export interface MonitorFormValues {
  readonly description: string;
  readonly namespace: string | undefined;
  readonly metricName: string | undefined;
  /** The chosen dimension set, as its canonical hash. */
  readonly dimensionsHash: string | undefined;
  readonly statistic: MetricStatistic;
  readonly periodMs: number;
  readonly evaluationPeriods: string;
  readonly datapointsToAlarm: string;
  readonly comparison: MonitorComparison;
  readonly threshold: string;
  readonly treatMissingData: TreatMissingData;
  readonly notify: boolean;
}

export function blankMonitorForm(metric?: MonitorMetric): MonitorFormValues {
  return {
    description: '',
    namespace: metric?.namespace,
    metricName: metric?.metricName,
    dimensionsHash: metric === undefined ? undefined : hashDimensions(metric.dimensions),
    statistic: metric?.statistic ?? 'avg',
    periodMs: 5 * MINUTE,
    evaluationPeriods: '3',
    datapointsToAlarm: '3',
    comparison: 'GreaterThanThreshold',
    threshold: '',
    treatMissingData: 'missing',
    notify: true,
  };
}

export function monitorFormOf(monitor: MonitorDefinition): MonitorFormValues {
  return {
    description: monitor.description ?? '',
    namespace: monitor.metric.namespace,
    metricName: monitor.metric.metricName,
    dimensionsHash: hashDimensions(monitor.metric.dimensions),
    statistic: monitor.metric.statistic,
    periodMs: monitor.periodMs,
    evaluationPeriods: String(monitor.evaluationPeriods),
    datapointsToAlarm: String(monitor.datapointsToAlarm),
    comparison: monitor.comparison,
    threshold: String(monitor.threshold),
    treatMissingData: monitor.treatMissingData,
    notify: monitor.notify,
  };
}

export type FormResult = { readonly definition: MonitorDefinition; readonly problem?: undefined } | { readonly definition?: undefined; readonly problem: string };

/** A number as typed, or `undefined` when it is not one yet. `Number('')` is 0, which is not what an empty box means. */
function typedNumber(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed.length === 0 ? undefined : Number(trimmed);
}

/**
 * The definition the form describes, held to the service's own rules, or what stops it
 * being one. The shared parser is the judge, so the form cannot accept what the service
 * would refuse.
 */
export function definitionOf(values: MonitorFormValues): FormResult {
  if (values.namespace === undefined || values.metricName === undefined || values.dimensionsHash === undefined) {
    return { problem: 'Choose a metric to watch.' };
  }
  if (typedNumber(values.threshold) === undefined) {
    return { problem: 'Enter a threshold.' };
  }
  try {
    const definition = parseMonitorDefinition(
      {
        description: values.description.trim().length === 0 ? undefined : values.description.trim(),
        metric: { namespace: values.namespace, metricName: values.metricName, dimensions: parseDimensionsHash(values.dimensionsHash), statistic: values.statistic },
        periodMs: values.periodMs,
        evaluationPeriods: typedNumber(values.evaluationPeriods),
        datapointsToAlarm: typedNumber(values.datapointsToAlarm),
        comparison: values.comparison,
        threshold: typedNumber(values.threshold),
        treatMissingData: values.treatMissingData,
        notify: values.notify,
      },
      'monitor',
    );
    return { definition };
  } catch (err) {
    // The parser names fields by their path; the form shows them by their label.
    const message = err instanceof Error ? err.message : String(err);
    return { problem: message.replace(/monitor\.(\w+)/g, (_match, field: string) => FIELD_LABELS[field] ?? field) };
  }
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  evaluationPeriods: 'Evaluation periods',
  datapointsToAlarm: 'Datapoints to alarm',
  threshold: 'Threshold',
  periodMs: 'Period',
  description: 'Description',
};

/** The most evaluation periods a period allows, so the window stays within a day. */
export function maxEvaluationPeriods(periodMs: number): number {
  return Math.floor(MONITOR_LIMITS.windowMs / periodMs);
}

const METRIC_PARAMS = { namespace: 'namespace', metricName: 'metric', dimension: 'dimension', statistic: 'statistic' } as const;

/** Query parameters that start a new monitor on a metric, as the metrics page links to one. */
export function metricSearch(metric: MonitorMetric): string {
  const params = new URLSearchParams();
  params.set(METRIC_PARAMS.namespace, metric.namespace);
  params.set(METRIC_PARAMS.metricName, metric.metricName);
  for (const [name, value] of Object.entries(metric.dimensions)) {
    params.append(METRIC_PARAMS.dimension, `${name}:${value}`);
  }
  params.set(METRIC_PARAMS.statistic, metric.statistic);
  return params.toString();
}

/** The metric a create link names, or `undefined` when it names none, or not all of one. */
export function metricFromSearch(params: URLSearchParams, statistics: ReadonlyArray<MetricStatistic>): MonitorMetric | undefined {
  const namespace = params.get(METRIC_PARAMS.namespace);
  const metricName = params.get(METRIC_PARAMS.metricName);
  const statistic = statistics.find((candidate) => candidate === params.get(METRIC_PARAMS.statistic));
  if (namespace === null || metricName === null || statistic === undefined) {
    return undefined;
  }
  const dimensions: Record<string, string> = {};
  for (const pair of params.getAll(METRIC_PARAMS.dimension)) {
    const separator = pair.indexOf(':');
    if (separator <= 0) {
      return undefined;
    }
    dimensions[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return { namespace, metricName, dimensions, statistic };
}

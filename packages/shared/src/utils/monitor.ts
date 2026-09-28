import { InvalidRequestError } from '../errors';
import { METRIC_RESOLUTION_MS, METRIC_STATISTICS } from '../models/metric';
import { EvaluatedDatapoint, MONITOR_COMPARISONS, MONITOR_LIMITS, MonitorComparison, MonitorDefinition, MonitorMetric, MonitorState, TREAT_MISSING_DATA } from '../models/monitor';
import {
  assertBoolean,
  assertInteger,
  assertKnownFields,
  assertNonEmptyString,
  assertNumber,
  assertOneOf,
  assertOptionalString,
  assertRecord,
  assertStringMap,
} from './assertions';

const MINUTE_MS = METRIC_RESOLUTION_MS['1m'];

/** Something a URL path carries as it is, as a dashboard's name is. */
const MONITOR_NAME = /^[A-Za-z0-9_-]+$/;

const RESERVED_MONITOR_NAME = 'new';

const DEFINITION_KEYS = ['description', 'metric', 'periodMs', 'evaluationPeriods', 'datapointsToAlarm', 'comparison', 'threshold', 'treatMissingData', 'notify'];
const METRIC_KEYS = ['namespace', 'metricName', 'dimensions', 'statistic'];

export function assertMonitorName(value: unknown, field: string): string {
  const name = assertNonEmptyString(value, field);
  if (name.length > MONITOR_LIMITS.nameLength || !MONITOR_NAME.test(name)) {
    throw new InvalidRequestError(`${field} must be letters, digits, hyphens and underscores, up to ${MONITOR_LIMITS.nameLength} characters, like "nas-cpu-high"`);
  }
  // `/monitors/new` is the console's create page, so a monitor by that name could never be opened.
  if (name === RESERVED_MONITOR_NAME) {
    throw new InvalidRequestError(`${field} cannot be "${RESERVED_MONITOR_NAME}", which the console uses for creating a monitor; choose another`);
  }
  return name;
}

function parseMetric(value: unknown, field: string): MonitorMetric {
  const record = assertRecord(value, field);
  assertKnownFields(record, field, METRIC_KEYS);
  return {
    namespace: assertNonEmptyString(record['namespace'], `${field}.namespace`),
    metricName: assertNonEmptyString(record['metricName'], `${field}.metricName`),
    dimensions: assertStringMap(record['dimensions'], `${field}.dimensions`),
    statistic: assertOneOf(record['statistic'], `${field}.statistic`, METRIC_STATISTICS),
  };
}

/** Checks what a caller wrote into a monitor, and returns it with nothing but the fields the format defines. */
export function parseMonitorDefinition(value: unknown, field: string): MonitorDefinition {
  const record = assertRecord(value, field);
  assertKnownFields(record, field, DEFINITION_KEYS);

  const description = assertOptionalString(record['description'], `${field}.description`);
  if (description !== undefined && description.length > MONITOR_LIMITS.descriptionLength) {
    throw new InvalidRequestError(`${field}.description must be at most ${MONITOR_LIMITS.descriptionLength} characters`);
  }

  const periodMs = assertInteger(record['periodMs'], `${field}.periodMs`);
  if (periodMs <= 0 || periodMs % MINUTE_MS !== 0) {
    throw new InvalidRequestError(`${field}.periodMs must be a whole number of minutes in milliseconds, like 300000 for five minutes`);
  }

  const evaluationPeriods = assertInteger(record['evaluationPeriods'], `${field}.evaluationPeriods`);
  if (evaluationPeriods < 1) {
    throw new InvalidRequestError(`${field}.evaluationPeriods must be at least 1`);
  }
  if (evaluationPeriods * periodMs > MONITOR_LIMITS.windowMs) {
    throw new InvalidRequestError(
      `${field}.evaluationPeriods × periodMs is ${describePeriods(evaluationPeriods, periodMs)}, longer than the day one evaluation may look back; use fewer or shorter periods`,
    );
  }

  const datapointsToAlarm = assertInteger(record['datapointsToAlarm'], `${field}.datapointsToAlarm`);
  if (datapointsToAlarm < 1 || datapointsToAlarm > evaluationPeriods) {
    throw new InvalidRequestError(`${field}.datapointsToAlarm must be from 1 to evaluationPeriods (${evaluationPeriods})`);
  }

  const threshold = assertNumber(record['threshold'], `${field}.threshold`);
  if (!Number.isFinite(threshold)) {
    throw new InvalidRequestError(`${field}.threshold must be a finite number`);
  }

  return {
    description: description === undefined || description.trim().length === 0 ? undefined : description,
    metric: parseMetric(record['metric'], `${field}.metric`),
    periodMs,
    evaluationPeriods,
    datapointsToAlarm,
    comparison: assertOneOf(record['comparison'], `${field}.comparison`, MONITOR_COMPARISONS),
    threshold,
    treatMissingData: assertOneOf(record['treatMissingData'], `${field}.treatMissingData`, TREAT_MISSING_DATA),
    notify: assertBoolean(record['notify'], `${field}.notify`),
  };
}

export const COMPARISON_SYMBOLS: Readonly<Record<MonitorComparison, string>> = {
  GreaterThanThreshold: '>',
  GreaterThanOrEqualToThreshold: '≥',
  LessThanThreshold: '<',
  LessThanOrEqualToThreshold: '≤',
};

export function breaches(value: number, comparison: MonitorComparison, threshold: number): boolean {
  switch (comparison) {
    case 'GreaterThanThreshold':
      return value > threshold;
    case 'GreaterThanOrEqualToThreshold':
      return value >= threshold;
    case 'LessThanThreshold':
      return value < threshold;
    case 'LessThanOrEqualToThreshold':
      return value <= threshold;
  }
}

function describeSpan(ms: number): string {
  const units: ReadonlyArray<readonly [string, number]> = [
    ['day', METRIC_RESOLUTION_MS['1d']],
    ['hour', METRIC_RESOLUTION_MS['1h']],
    ['minute', MINUTE_MS],
  ];
  const [unit, size] = units.find(([, candidate]) => ms % candidate === 0) ?? ['minute', MINUTE_MS];
  const count = ms / size;
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function describePeriods(count: number, periodMs: number): string {
  return count === 1 ? `1 period of ${describeSpan(periodMs)}` : `${count} periods of ${describeSpan(periodMs)}`;
}

function formatValue(value: number): string {
  return String(Number(value.toPrecision(6)));
}

export interface MonitorEvaluationInput {
  readonly definition: MonitorDefinition;
  /** Kept when missing data is ignored and there is none in the window. */
  readonly currentState: MonitorState;
  /** The series' datapoints in the window. Periods without one are simply absent. */
  readonly datapoints: ReadonlyArray<{ readonly timestamp: number; readonly value: number }>;
  /** The exclusive end of the window, on a period boundary: the last closed period ends here. */
  readonly windowEnd: number;
}

export interface MonitorEvaluation {
  readonly state: MonitorState;
  readonly reason: string;
  /** Every period of the window, oldest first, with `null` where the series had nothing. */
  readonly datapoints: ReadonlyArray<EvaluatedDatapoint>;
}

/**
 * Decides a monitor's state from its last N periods.
 *
 * ALARM when at least M of them breach. A period with no datapoint counts as the
 * monitor's `treatMissingData` says: as a breach, as not one, or as nothing at all. In
 * the last two cases a window with no datapoint whatever cannot be judged, and is
 * `INSUFFICIENT_DATA` or leaves the state as it was.
 *
 * Unlike CloudWatch it does not look further back than N periods for datapoints when
 * the window is sparse: what it judges is exactly the window the console graphs.
 */
export function evaluateMonitor(input: MonitorEvaluationInput): MonitorEvaluation {
  const { definition, windowEnd } = input;
  const { periodMs, evaluationPeriods, datapointsToAlarm, comparison, threshold, treatMissingData } = definition;

  const values = new Map(input.datapoints.map((datapoint) => [datapoint.timestamp, datapoint.value]));
  const datapoints: EvaluatedDatapoint[] = [];
  for (let index = evaluationPeriods; index >= 1; index -= 1) {
    const timestamp = windowEnd - index * periodMs;
    datapoints.push({ timestamp, value: values.get(timestamp) ?? null });
  }

  const window = `the last ${describePeriods(evaluationPeriods, periodMs)}`;
  const rule = `${definition.metric.statistic} ${COMPARISON_SYMBOLS[comparison]} ${formatValue(threshold)}`;
  const present = datapoints.flatMap((datapoint) => (datapoint.value === null ? [] : [datapoint.value]));
  const missing = datapoints.length - present.length;

  if (present.length === 0 && (treatMissingData === 'missing' || treatMissingData === 'ignore')) {
    if (treatMissingData === 'ignore') {
      return { state: input.currentState, reason: `No datapoint in ${window}; missing data is ignored, so the state is kept.`, datapoints };
    }
    return { state: 'INSUFFICIENT_DATA', reason: `No datapoint in ${window}.`, datapoints };
  }

  const missingBreaches = treatMissingData === 'breaching' ? missing : 0;
  const breaching = present.filter((value) => breaches(value, comparison, threshold)).length + missingBreaches;

  const latest = [...datapoints].reverse().find((datapoint) => datapoint.value !== null);
  const notes = [
    latest === undefined || latest.value === null ? undefined : `the latest was ${formatValue(latest.value)}`,
    missing === 0
      ? undefined
      : `${missing} had no datapoint and ${treatMissingData === 'breaching' ? 'counted as breaching' : treatMissingData === 'notBreaching' ? 'counted as not breaching' : 'were not counted'}`,
  ].filter((note) => note !== undefined);
  const detail = notes.length === 0 ? '' : ` (${notes.join('; ')})`;

  if (breaching >= datapointsToAlarm) {
    return { state: 'ALARM', reason: `${breaching} of ${window} breached ${rule}, at least the ${datapointsToAlarm} that raise the alarm${detail}.`, datapoints };
  }
  return { state: 'OK', reason: `${breaching} of ${window} breached ${rule}, fewer than the ${datapointsToAlarm} that raise the alarm${detail}.`, datapoints };
}

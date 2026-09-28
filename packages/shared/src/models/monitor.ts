import { MetricDimensions, MetricStatistic } from './metric';

/**
 * A monitor watches one statistic of one series against a threshold, and is in alarm
 * when enough of its recent periods breach it. CloudWatch's alarm, field for field
 * where the two share a concept, so its documentation explains this one too.
 */

export type MonitorComparison = 'GreaterThanThreshold' | 'GreaterThanOrEqualToThreshold' | 'LessThanThreshold' | 'LessThanOrEqualToThreshold';

export const MONITOR_COMPARISONS: ReadonlyArray<MonitorComparison> = ['GreaterThanThreshold', 'GreaterThanOrEqualToThreshold', 'LessThanThreshold', 'LessThanOrEqualToThreshold'];

/**
 * What a period with no datapoint counts as.
 *
 * - `missing`: nothing. With no datapoint in the whole window the state is `INSUFFICIENT_DATA`.
 * - `ignore`: nothing. With no datapoint in the whole window the state stays as it was.
 * - `breaching`: a breach.
 * - `notBreaching`: not a breach.
 */
export type TreatMissingData = 'missing' | 'ignore' | 'breaching' | 'notBreaching';

export const TREAT_MISSING_DATA: ReadonlyArray<TreatMissingData> = ['missing', 'ignore', 'breaching', 'notBreaching'];

export type MonitorState = 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';

export const MONITOR_STATES: ReadonlyArray<MonitorState> = ['OK', 'ALARM', 'INSUFFICIENT_DATA'];

export const MONITOR_LIMITS = {
  nameLength: 255,
  descriptionLength: 1024,
  /**
   * How far back one evaluation looks. A day keeps a percentile monitor inside raw
   * retention, and keeps one evaluation to a single page of datapoints.
   */
  windowMs: 86_400_000,
} as const;

/** The series a monitor reads. A graph query without what only a graph needs. */
export interface MonitorMetric {
  readonly namespace: string;
  readonly metricName: string;
  /** The exact set, as `GetMetricDataRequest` requires. */
  readonly dimensions: MetricDimensions;
  readonly statistic: MetricStatistic;
}

/** What a caller writes. */
export interface MonitorDefinition {
  readonly description?: string;
  readonly metric: MonitorMetric;
  /** Bucket width, a whole number of minutes. */
  readonly periodMs: number;
  /** N: how many of the most recent periods are looked at. */
  readonly evaluationPeriods: number;
  /** M: how many of those must breach for the monitor to be in alarm. At most N. */
  readonly datapointsToAlarm: number;
  readonly comparison: MonitorComparison;
  readonly threshold: number;
  readonly treatMissingData: TreatMissingData;
  /** Whether a change of state is handed to the notifier. The monitor is evaluated either way. */
  readonly notify: boolean;
}

export interface Monitor extends MonitorDefinition {
  /** The monitor's identity and the key in its link. It cannot be renamed. */
  readonly name: string;
  readonly state: MonitorState;
  /** Why it is in that state, in words. */
  readonly stateReason: string;
  readonly stateChangedAt: number;
  /** Absent until the evaluator has run once. */
  readonly lastEvaluatedAt?: number;
  /** Bumped on every save of the definition; an update must name the one it was made from. */
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** One period of an evaluation: its value, or `null` when the series had no datapoint in it. */
export interface EvaluatedDatapoint {
  readonly timestamp: number;
  readonly value: number | null;
}

export interface MonitorStateChange {
  readonly monitorName: string;
  readonly fromState: MonitorState;
  readonly toState: MonitorState;
  readonly reason: string;
  /** The periods the decision was made on, oldest first. */
  readonly datapoints: ReadonlyArray<EvaluatedDatapoint>;
  /** The threshold at the time, since the definition may change later. */
  readonly threshold: number;
  readonly changedAt: number;
}

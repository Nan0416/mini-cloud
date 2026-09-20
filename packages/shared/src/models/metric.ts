/**
 * Metrics use the AWS CloudWatch embedded metric format (EMF) as their wire format.
 *
 * The types below mirror the published specification exactly, capitalised members and
 * all, so a document mini-cloud produces is a document CloudWatch Logs would ingest
 * unchanged. That is the whole point of the choice: the day any of this moves to AWS,
 * the instrumentation already speaks the right language.
 *
 * Spec: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
 */

/** The 26 units CloudWatch accepts. Anything else is rejected rather than coerced. */
export type MetricUnit =
  | 'Seconds'
  | 'Microseconds'
  | 'Milliseconds'
  | 'Bytes'
  | 'Kilobytes'
  | 'Megabytes'
  | 'Gigabytes'
  | 'Terabytes'
  | 'Bits'
  | 'Kilobits'
  | 'Megabits'
  | 'Gigabits'
  | 'Terabits'
  | 'Percent'
  | 'Count'
  | 'Bytes/Second'
  | 'Kilobytes/Second'
  | 'Megabytes/Second'
  | 'Gigabytes/Second'
  | 'Terabytes/Second'
  | 'Bits/Second'
  | 'Kilobits/Second'
  | 'Megabits/Second'
  | 'Gigabits/Second'
  | 'Terabits/Second'
  | 'Count/Second'
  | 'None';

export const METRIC_UNITS: ReadonlyArray<MetricUnit> = [
  'Seconds',
  'Microseconds',
  'Milliseconds',
  'Bytes',
  'Kilobytes',
  'Megabytes',
  'Gigabytes',
  'Terabytes',
  'Bits',
  'Kilobits',
  'Megabits',
  'Gigabits',
  'Terabits',
  'Percent',
  'Count',
  'Bytes/Second',
  'Kilobytes/Second',
  'Megabytes/Second',
  'Gigabytes/Second',
  'Terabytes/Second',
  'Bits/Second',
  'Kilobits/Second',
  'Megabits/Second',
  'Gigabits/Second',
  'Terabits/Second',
  'Count/Second',
  'None',
];

/** 1 stores at sub-minute resolution, 60 at one minute. CloudWatch accepts no other value. */
export type StorageResolution = 1 | 60;

export const STORAGE_RESOLUTIONS: ReadonlyArray<StorageResolution> = [1, 60];

export interface EmfMetricDefinition {
  readonly Name: string;
  readonly Unit?: MetricUnit;
  readonly StorageResolution?: StorageResolution;
}

export interface EmfMetricDirective {
  readonly Namespace: string;
  /**
   * Each inner array names root-node members that become one metric's dimensions.
   * Every set published creates a separate series, which is why a query has to name
   * the exact set it wants rather than a subset of one.
   */
  readonly Dimensions: ReadonlyArray<ReadonlyArray<string>>;
  readonly Metrics: ReadonlyArray<EmfMetricDefinition>;
}

export interface EmfMetadata {
  /** Milliseconds since the epoch. */
  readonly Timestamp: number;
  readonly CloudWatchMetrics: ReadonlyArray<EmfMetricDirective>;
}

/**
 * One embedded-metric-format log event.
 *
 * `_aws` is metadata; every other root member is a "target member" the metadata points
 * at by name — a string for a dimension, a number or array of numbers for a metric, and
 * anything at all for a property, which is context rather than a series.
 */
export interface EmfDocument {
  readonly _aws: EmfMetadata;
  readonly [key: string]: unknown;
}

/** Limits the specification places on a single document. */
export const EMF_LIMITS = {
  /** A CloudWatch Logs event, and therefore an EMF document, may not exceed 1 MB. */
  documentBytes: 1_048_576,
  metricDefinitionsPerDirective: 100,
  dimensionsPerSet: 30,
  dimensionNameLength: 250,
  dimensionValueLength: 1024,
  namespaceLength: 1024,
  metricNameLength: 1024,
  valuesPerMetric: 100,
} as const;

// ---------------------------------------------------------------------------
// Stored and queried shapes
// ---------------------------------------------------------------------------

/** The three buckets every datum is rolled into as it arrives. */
export type MetricResolution = '1m' | '1h' | '1d';

export const METRIC_RESOLUTIONS: ReadonlyArray<MetricResolution> = ['1m', '1h', '1d'];

export const METRIC_RESOLUTION_MS: Readonly<Record<MetricResolution, number>> = {
  '1m': 60_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
};

export type MetricStatistic = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'p50' | 'p75' | 'p90' | 'p95' | 'p99';

export const METRIC_STATISTICS: ReadonlyArray<MetricStatistic> = ['sum', 'avg', 'min', 'max', 'count', 'p50', 'p75', 'p90', 'p95', 'p99'];

/** Statistics that need the distribution, and so can only be answered from 1m rows. */
export const PERCENTILE_STATISTICS: ReadonlyArray<MetricStatistic> = ['p50', 'p75', 'p90', 'p95', 'p99'];

export interface MetricDimensions {
  readonly [name: string]: string;
}

/**
 * Observation value to the number of times it was seen.
 *
 * Keeping a distribution rather than every observation is what makes percentiles
 * possible without storing raw data forever; `compactHistogram` bounds how many
 * distinct values it can hold.
 */
export interface MetricHistogram {
  readonly [value: string]: number;
}

/** Count, sum, min and max — the four that merge exactly, in any order. */
export interface MetricStatisticSet {
  readonly sampleCount: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
}

/**
 * One metric, one dimension set, one minute, as an agent reports it.
 *
 * Several agents may report the same bucket for the same series. Because every field
 * here merges commutatively — counts and sums add, min and max take extremes, and
 * histograms add per value — the order they arrive in does not affect the result.
 */
export interface MetricDatum extends MetricStatisticSet {
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensions: MetricDimensions;
  readonly unit: MetricUnit;
  /** Start of the minute this datum covers, in milliseconds since the epoch. */
  readonly bucketStart: number;
  readonly histogram: MetricHistogram;
}

/** A metric the service has seen, for the console's pickers. */
export interface MetricSummary {
  readonly namespace: string;
  readonly metricName: string;
  readonly unit: MetricUnit;
  readonly lastSeenAt: number;
}

export interface MetricDatapoint {
  readonly timestamp: number;
  readonly value: number;
}

/** Why one datum in an otherwise good batch was not stored. */
export interface RejectedMetricDatum {
  readonly metricName: string;
  readonly bucketStart: number;
  readonly reason: string;
}

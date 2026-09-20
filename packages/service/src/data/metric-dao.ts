import { MetricDatapoint, MetricDatum, MetricDimensions, MetricResolution, MetricStatistic, MetricSummary, MetricUnit } from '@mini-cloud/shared';

/**
 * Metric storage.
 *
 * Every method takes one Input and returns one Output, like the other DAOs. Inputs are
 * flat and match the columns rather than the API shape; outputs wrap the shared domain
 * models.
 */

export interface PutMetricDataInput {
  readonly batchId: string;
  readonly agentId: string;
  readonly data: ReadonlyArray<MetricDatum>;
}

export interface PutMetricDataOutput {
  readonly accepted: number;
  /** True when this batch had already been applied, so nothing was written. */
  readonly duplicate: boolean;
}

export interface ListNamespacesInput {}

export interface ListNamespacesOutput {
  readonly namespaces: ReadonlyArray<string>;
}

export interface ListMetricsInput {
  readonly namespace: string;
}

export interface ListMetricsOutput {
  readonly metrics: ReadonlyArray<MetricSummary>;
}

export interface ListDimensionSetsInput {
  readonly namespace: string;
  readonly metricName: string;
}

export interface ListDimensionSetsOutput {
  readonly dimensionSets: ReadonlyArray<MetricDimensions>;
}

export interface ReadSeriesInput {
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensionsHash: string;
  readonly resolution: MetricResolution;
  readonly statistic: MetricStatistic;
  /** Width of each returned bucket. A whole multiple of the resolution. */
  readonly periodMs: number;
  readonly from: number;
  readonly to: number;
}

export interface ReadSeriesOutput {
  /** Undefined when the series has never been written. */
  readonly unit?: MetricUnit;
  readonly datapoints: ReadonlyArray<MetricDatapoint>;
}

export interface EnsurePartitionsInput {
  /** Every bucket the caller is about to write, so late data gets a home too. */
  readonly buckets: ReadonlyArray<{ readonly resolution: MetricResolution; readonly bucketStart: number }>;
}

export interface EnsurePartitionsOutput {
  readonly created: ReadonlyArray<string>;
}

export interface DropExpiredPartitionsInput {
  /** Nothing older than this is kept at '1m'. */
  readonly rawCutoff: number;
  /** Nothing older than this is kept at '1h' or '1d'. */
  readonly rollupCutoff: number;
  /** Ingest batch records older than this are pruned. */
  readonly batchCutoff: number;
}

export interface DropExpiredPartitionsOutput {
  readonly dropped: ReadonlyArray<string>;
  readonly prunedBatches: number;
}

export interface MetricDao {
  /**
   * Merges a batch into every resolution, in one transaction.
   *
   * Idempotent by `batchId`: an agent that cannot tell whether its post arrived
   * resends the identical batch, and a replay writes nothing.
   */
  putMetricData(input: PutMetricDataInput): Promise<PutMetricDataOutput>;

  listNamespaces(input: ListNamespacesInput): Promise<ListNamespacesOutput>;

  listMetrics(input: ListMetricsInput): Promise<ListMetricsOutput>;

  listDimensionSets(input: ListDimensionSetsInput): Promise<ListDimensionSetsOutput>;

  readSeries(input: ReadSeriesInput): Promise<ReadSeriesOutput>;

  /** Creates any leaf partition the given buckets need. Cheap to call repeatedly. */
  ensurePartitions(input: EnsurePartitionsInput): Promise<EnsurePartitionsOutput>;

  dropExpiredPartitions(input: DropExpiredPartitionsInput): Promise<DropExpiredPartitionsOutput>;
}

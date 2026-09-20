import { MetricDatapoint, MetricDatum, MetricDimensions, MetricResolution, MetricStatistic, MetricSummary, MetricUnit, RejectedMetricDatum } from '../models/metric';

/**
 * Agent -> service, once a tick, on the internal listener.
 *
 * `batchId` is what makes ingest exactly-once. An agent that cannot tell whether a
 * post arrived resends the identical batch under the identical id, and the service
 * recognises the replay and does nothing. Without it a retry would be added on top of
 * a write that had already succeeded, because the merge is additive.
 */
export interface PutMetricDataRequest {
  readonly agentId: string;
  readonly batchId: string;
  readonly data: ReadonlyArray<MetricDatum>;
}

export interface PutMetricDataResponse {
  readonly accepted: number;
  /** Data outside the acceptance window. The rest of the batch is still stored. */
  readonly rejected: ReadonlyArray<RejectedMetricDatum>;
  /** True when this batch id had already been applied, so nothing changed. */
  readonly duplicate: boolean;
}

/**
 * Listings are paged by keyset rather than by offset: the cursor is the last name
 * returned, and the next page is everything ordered after it. A row inserted while
 * someone is paging therefore cannot shift a later page onto entries they have
 * already seen, which an OFFSET would.
 */
export interface ListMetricNamespacesRequest {
  readonly limit?: number;
  /** The previous page's `nextCursor`. Omit for the first page. */
  readonly after?: string;
}

export interface ListMetricNamespacesResponse {
  readonly namespaces: ReadonlyArray<string>;
  /** Pass back as `after`. Absent when this was the last page. */
  readonly nextCursor?: string;
}

export interface ListMetricNamesRequest {
  readonly namespace: string;
  readonly limit?: number;
  /** The previous page's `nextCursor`. Omit for the first page. */
  readonly after?: string;
}

export interface ListMetricNamesResponse {
  readonly metrics: ReadonlyArray<MetricSummary>;
  /** Pass back as `after`. Absent when this was the last page. */
  readonly nextCursor?: string;
}

/**
 * The dimension sets a metric has been published with.
 *
 * Every set is a separate series, so this is how a caller discovers what it may ask
 * `getMetricData` for.
 */
export interface ListMetricDimensionsRequest {
  readonly namespace: string;
  readonly metricName: string;
}

export interface ListMetricDimensionsResponse {
  readonly dimensionSets: ReadonlyArray<MetricDimensions>;
}

export interface GetMetricDataRequest {
  readonly namespace: string;
  readonly metricName: string;
  readonly statistic: MetricStatistic;
  /** Bucket width of the returned series. Must be a multiple of a minute. */
  readonly periodMs: number;
  readonly from: number;
  /** Defaults to now, and is clamped to the point every agent has had time to report. */
  readonly to?: number;
  /**
   * The exact dimension set to read, defaulting to the empty set. A subset would sum
   * across sets that each already counted the same observation.
   */
  readonly dimensions?: MetricDimensions;
}

export interface GetMetricDataResponse {
  readonly unit: MetricUnit;
  readonly periodMs: number;
  /** Which stored resolution answered the query. */
  readonly resolution: MetricResolution;
  readonly datapoints: ReadonlyArray<MetricDatapoint>;
}

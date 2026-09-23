import {
  GetMetricDataRequest,
  GetMetricDataResponse,
  InvalidRequestError,
  ListMetricDimensionsRequest,
  ListMetricDimensionsResponse,
  ListMetricNamesRequest,
  ListMetricNamesResponse,
  ListMetricNamespacesRequest,
  ListMetricNamespacesResponse,
  LoggerFactory,
  METRIC_MAX_DATAPOINTS,
  METRIC_RESOLUTIONS,
  METRIC_RESOLUTION_MS,
  MetricDatum,
  MetricResolution,
  PERCENTILE_STATISTICS,
  PutMetricDataRequest,
  PutMetricDataResponse,
  RejectedMetricDatum,
  coarsestResolutionFor,
  floorToPeriod,
  assertTimestamp,
  floorToResolution,
  hashDimensions,
  unitForStatistic,
} from '@mini-cloud/shared';
import { MetricDao } from '../data/metric-dao';

const logger = LoggerFactory.getLogger('MetricService');

/** CloudWatch refuses a timestamp more than two hours ahead; so does this. */
const MAX_FUTURE_MS = 2 * 3600_000;

const DAY_MS = 86_400_000;

export interface MetricConfig {
  /**
   * How long 1m rows live. The same number bounds three things on purpose: raw
   * storage, how far back percentiles can be answered, and how late an agent may
   * report — so data that is accepted always has a partition to land in.
   */
  readonly rawRetentionDays: number;
  /** How long the hour and day rollups live. */
  readonly rollupRetentionDays: number;
  /**
   * How far behind now a query stops.
   *
   * Without it a chart would show the newest bucket holding only the agents that
   * happened to report first — a datapoint that dips and then silently corrects
   * itself a minute later, which is worse than one that is not there yet.
   */
  readonly queryLagMs: number;
  /** How long a delivered batch is remembered, for recognising a retry. */
  readonly ingestBatchRetentionMs: number;
}

export interface MetricServiceProps {
  readonly metricDao: MetricDao;
  readonly config: MetricConfig;
}

/**
 * Metric ingest and query.
 *
 * Ingest is deliberately forgiving: a datum outside the acceptance window is named in
 * the response rather than failing the batch, because one machine with a wrong clock
 * must not cost every other machine its minute.
 */
export class MetricService {
  private readonly metricDao: MetricDao;
  private readonly config: MetricConfig;

  constructor(props: MetricServiceProps) {
    this.metricDao = props.metricDao;
    this.config = props.config;
  }

  async putMetricData(request: PutMetricDataRequest, now: number = Date.now()): Promise<PutMetricDataResponse> {
    const oldest = now - this.config.rawRetentionDays * DAY_MS;
    const newest = now + MAX_FUTURE_MS;

    const accepted: MetricDatum[] = [];
    const rejected: RejectedMetricDatum[] = [];

    for (const datum of request.data) {
      if (datum.bucketStart < oldest) {
        rejected.push({
          metricName: datum.metricName,
          bucketStart: datum.bucketStart,
          reason: `older than the ${this.config.rawRetentionDays}-day retention window, so there is nowhere left to store it`,
        });
        continue;
      }
      if (datum.bucketStart > newest) {
        rejected.push({ metricName: datum.metricName, bucketStart: datum.bucketStart, reason: 'more than two hours in the future; check the reporting machine’s clock' });
        continue;
      }
      accepted.push(datum);
    }

    if (rejected.length > 0) {
      logger.warn(`Agent ${request.agentId} sent ${rejected.length} metric datum(s) outside the acceptance window; the other ${accepted.length} were stored.`);
    }

    if (accepted.length === 0) {
      return { accepted: 0, rejected, duplicate: false };
    }

    // Driven by the data's own buckets, not by today, so a machine that was offline
    // for a week still finds a partition waiting when it comes back.
    await this.metricDao.ensurePartitions({
      buckets: accepted.flatMap((datum) => METRIC_RESOLUTIONS.map((resolution) => ({ resolution, bucketStart: floorToResolution(datum.bucketStart, resolution) }))),
    });

    const result = await this.metricDao.putMetricData({ batchId: request.batchId, agentId: request.agentId, data: accepted });
    return { accepted: result.accepted, rejected, duplicate: result.duplicate };
  }

  async listNamespaces(request: ListMetricNamespacesRequest): Promise<ListMetricNamespacesResponse> {
    const { namespaces, nextCursor } = await this.metricDao.listNamespaces({ limit: request.limit, after: request.after });
    return { namespaces, nextCursor };
  }

  async listMetricNames(request: ListMetricNamesRequest): Promise<ListMetricNamesResponse> {
    const { metrics, nextCursor } = await this.metricDao.listMetrics({ namespace: request.namespace, limit: request.limit, after: request.after });
    return { metrics, nextCursor };
  }

  async listDimensions(request: ListMetricDimensionsRequest): Promise<ListMetricDimensionsResponse> {
    const { dimensionSets } = await this.metricDao.listDimensionSets({ namespace: request.namespace, metricName: request.metricName });
    return { dimensionSets };
  }

  async getMetricData(request: GetMetricDataRequest, now: number = Date.now()): Promise<GetMetricDataResponse> {
    const periodMs = request.periodMs;
    if (periodMs % METRIC_RESOLUTION_MS['1m'] !== 0) {
      throw new InvalidRequestError(`periodMs must be a whole number of minutes, because metrics are stored by the minute. Round ${periodMs} to a multiple of 60000.`);
    }

    assertTimestamp(request.from, 'from');
    if (request.to !== undefined) {
      assertTimestamp(request.to, 'to');
    }

    // Clamped before anything else: a bucket only some agents have reported yet is
    // not a datapoint, it is a partial one. Both ends are then floored to the period
    // for the same reason — an unaligned end returns a final bucket covering only
    // part of its period, which is the dipping last datapoint `queryLagMs` exists to
    // prevent. The period in progress is therefore not returned until it closes.
    const watermark = now - this.config.queryLagMs;
    const end = Math.min(request.to ?? now, watermark);
    const to = floorToPeriod(end, periodMs);
    const from = floorToPeriod(request.from, periodMs);
    if (from >= to) {
      // An empty window at `from`, rather than one that ends before it starts.
      return { unit: unitForStatistic(request.statistic, 'None'), periodMs, resolution: coarsestResolutionFor(periodMs), from, to: from, datapoints: [] };
    }

    const resolution = this.resolutionFor(request, periodMs, from, now);

    // After the percentile check, because no period can fix that refusal.
    const buckets = (to - from) / periodMs;
    if (buckets > METRIC_MAX_DATAPOINTS) {
      // Sized from the unfloored span, so a read at the suggested period is known to fit.
      const minutes = Math.ceil((end - request.from) / METRIC_MAX_DATAPOINTS / METRIC_RESOLUTION_MS['1m']);
      throw new InvalidRequestError(
        `A ${periodMs / METRIC_RESOLUTION_MS['1m']}-minute period over this range is ${buckets} datapoints, more than the ${METRIC_MAX_DATAPOINTS} one read may return. ` +
          `Use a period of at least ${minutes} minutes (${minutes * METRIC_RESOLUTION_MS['1m']} ms), or a shorter range.`,
      );
    }

    const dimensionsHash = hashDimensions(request.dimensions ?? {});

    const { unit, datapoints } = await this.metricDao.readSeries({
      namespace: request.namespace,
      metricName: request.metricName,
      dimensionsHash,
      resolution,
      statistic: request.statistic,
      periodMs,
      from,
      to,
    });

    // A count is a count whatever the series measures, so it is not reported in the metric's unit.
    return { unit: unitForStatistic(request.statistic, unit ?? 'None'), periodMs, resolution, from, to, datapoints };
  }

  /**
   * The coarsest stored resolution that can answer this query.
   *
   * A percentile is the exception: it needs the distribution, which only the minute
   * rows keep, so it is pinned to `1m` and refused outside raw retention rather than
   * being answered with an average of percentiles.
   */
  private resolutionFor(request: GetMetricDataRequest, periodMs: number, from: number, now: number): MetricResolution {
    if (!PERCENTILE_STATISTICS.some((statistic) => statistic === request.statistic)) {
      return coarsestResolutionFor(periodMs);
    }

    const oldest = now - this.config.rawRetentionDays * DAY_MS;
    if (from < oldest) {
      throw new InvalidRequestError(
        `${request.statistic} is only available for the last ${this.config.rawRetentionDays} days, because the distribution it needs is not kept beyond that. ` +
          `Request avg, min, max, sum or count for this range, or move "from" to ${new Date(oldest).toISOString()} or later.`,
      );
    }
    return '1m';
  }
}

import { InvalidRequestError, METRIC_RESOLUTION_MS, MetricResolution, MetricStatistic, PERCENTILE_STATISTICS, coarsestResolutionFor, floorToPeriod } from '@mini-cloud/shared';

/**
 * Which buckets a metric read covers, and where they are read from. Shared by a graph's
 * read and a monitor's evaluation, so a monitor judges exactly what the graph draws.
 */

export interface MetricReadWindowInput {
  readonly from: number;
  /** Defaults to now. */
  readonly to?: number;
  readonly periodMs: number;
  readonly now: number;
  readonly queryLagMs: number;
}

export interface MetricReadWindow {
  readonly from: number;
  /** Exclusive. At or before `from` when there is nothing to read. */
  readonly to: number;
}

/**
 * Clamped before anything else: a bucket only some agents have reported yet is not a
 * datapoint, it is a partial one. Both ends are then floored to the period for the same
 * reason — an unaligned end returns a final bucket covering only part of its period,
 * which is the dipping last datapoint `queryLagMs` exists to prevent. The period in
 * progress is therefore not read until it closes.
 */
export function metricReadWindow(input: MetricReadWindowInput): MetricReadWindow {
  const watermark = input.now - input.queryLagMs;
  const end = Math.min(input.to ?? input.now, watermark);
  return { from: floorToPeriod(input.from, input.periodMs), to: floorToPeriod(end, input.periodMs) };
}

export interface MetricResolutionInput {
  readonly statistic: MetricStatistic;
  readonly periodMs: number;
  readonly from: number;
  readonly now: number;
  readonly rawRetentionDays: number;
}

/**
 * The coarsest stored resolution that can answer a read.
 *
 * A percentile is the exception: it needs the distribution, which only the minute rows
 * keep, so it is pinned to `1m` and refused outside raw retention rather than being
 * answered with an average of percentiles.
 */
export function metricResolutionFor(input: MetricResolutionInput): MetricResolution {
  if (!PERCENTILE_STATISTICS.some((statistic) => statistic === input.statistic)) {
    return coarsestResolutionFor(input.periodMs);
  }

  const oldest = input.now - input.rawRetentionDays * METRIC_RESOLUTION_MS['1d'];
  if (input.from < oldest) {
    throw new InvalidRequestError(
      `${input.statistic} is only available for the last ${input.rawRetentionDays} days, because the distribution it needs is not kept beyond that. ` +
        `Request avg, min, max, sum or count for this range, or move "from" to ${new Date(oldest).toISOString()} or later.`,
    );
  }
  return '1m';
}

import { METRIC_RESOLUTION_MS, MetricResolution } from '../models/metric';

/**
 * Bucket arithmetic, shared because the agent and the service must agree on it: the
 * agent decides which minute an observation belongs to, and the service decides which
 * hour and day that minute rolls into. A disagreement would split one series in two.
 */

/**
 * The start of the bucket a timestamp falls in.
 *
 * Plain floor division works for all three widths because the epoch is itself midnight
 * UTC, so minute, hour and day boundaries are all multiples of it.
 */
export function floorToResolution(timestamp: number, resolution: MetricResolution): number {
  const width = METRIC_RESOLUTION_MS[resolution];
  return Math.floor(timestamp / width) * width;
}

/** The start of the bucket of an arbitrary width a timestamp falls in. */
export function floorToPeriod(timestamp: number, periodMs: number): number {
  return Math.floor(timestamp / periodMs) * periodMs;
}

/**
 * The coarsest stored resolution that can answer a query of this period.
 *
 * A period is answerable from a resolution when it is a whole multiple of it, so the
 * stored buckets line up with the requested ones and none is split across two.
 * Coarsest first, because reading a year from daily rows beats reading it from
 * half a million minutes.
 */
export function coarsestResolutionFor(periodMs: number): MetricResolution {
  for (const resolution of ['1d', '1h', '1m'] as const) {
    if (periodMs % METRIC_RESOLUTION_MS[resolution] === 0) {
      return resolution;
    }
  }
  return '1m';
}

import { floorToPeriod, type GetMetricDataResponse, type MetricTimeRange } from '@mini-cloud/shared';
import type { GraphSeries } from '@/hooks/use-metrics';
import { isRetryable } from '@/lib/errors';

/** How a graph's answers are polled and framed, apart from the hook so it can be tested. */

/**
 * Whether a series is worth asking for again.
 *
 * A failure decides on its own: a read the service refused would be refused the same way
 * every minute, while one that failed on the way there could pass next time, so an
 * outage heals itself whichever kind of window is on screen. Otherwise a relative window
 * always has newer buckets, and an absolute one has until the service has answered up to
 * its end — which trails now by `queryLagMs`, so a window ending now is still short of
 * its end when it ends.
 */
export function shouldPoll(range: MetricTimeRange, periodMs: number, data: GetMetricDataResponse | undefined, error: Error | null): boolean {
  if (error !== null) {
    return isRetryable(error);
  }
  if (range.kind === 'relative') {
    return true;
  }
  return data === undefined || data.to < floorToPeriod(range.to, periodMs);
}

/** The window a chart is drawn over, and the width of its buckets. */
export interface GraphFrame {
  readonly from: number;
  /** Exclusive. */
  readonly to: number;
  readonly periodMs: number;
}

/**
 * The frame to draw in: the current answers' window, or while none has arrived, one
 * stand-in's.
 *
 * One period only, because two cannot share a grid of buckets, and a stand-in read at a
 * finer period over a longer window would ask for tens of thousands of them. Current
 * answers all come from the graph's own window, so their union is that window give or
 * take a bucket. Stand-ins can come from any earlier window, so only one of theirs is used.
 */
export function frameOf(series: ReadonlyArray<GraphSeries>): GraphFrame | undefined {
  const answers = series.flatMap((entry) => (entry.data === undefined ? [] : [{ data: entry.data, placeholder: entry.placeholder }]));
  const current = answers.filter((entry) => !entry.placeholder).map((entry) => entry.data);
  const chosen = current.length > 0 ? current : answers.slice(0, 1).map((entry) => entry.data);
  if (chosen.length === 0) {
    return undefined;
  }
  const periodMs = chosen[0].periodMs;
  const peers = chosen.filter((data) => data.periodMs === periodMs);
  return { from: Math.min(...peers.map((data) => data.from)), to: Math.max(...peers.map((data) => data.to)), periodMs };
}

/** Whether a series' answer lands on the frame's buckets, which only one read at the frame's period does. */
export function isDrawableIn(entry: GraphSeries, frame: GraphFrame | undefined): boolean {
  return entry.data !== undefined && frame !== undefined && entry.data.periodMs === frame.periodMs;
}

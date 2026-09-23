import { InvalidRequestError, ServiceUnreachableError, type GetMetricDataResponse, type MetricQuery } from '@mini-cloud/shared';
import type { GraphSeries } from '@/hooks/use-metrics';
import { frameOf, isDrawableIn, shouldPoll } from '@/lib/metric-graph-data';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 8, 21, 12, 0);

const QUERY: MetricQuery = { id: 'm1', namespace: 'MyApp', metricName: 'Latency', dimensions: {}, statistic: 'avg' };

function answer(from: number, to: number, periodMs: number): GetMetricDataResponse {
  return { unit: 'Milliseconds', periodMs, resolution: '1m', from, to, datapoints: [] };
}

function entry(data: GetMetricDataResponse | undefined, placeholder = false): GraphSeries {
  return { query: QUERY, data, error: null, placeholder, refetch: () => undefined };
}

describe('shouldPoll', () => {
  it('keeps polling a relative window, which moves with the clock', () => {
    expect(shouldPoll({ kind: 'relative', durationMs: HOUR }, MINUTE, answer(NOW - HOUR, NOW - 3 * MINUTE, MINUTE), null)).toBe(true);
  });

  it('stops asking for a read the service refused, which would be refused again', () => {
    // A percentile past raw retention fails the same way every minute.
    expect(shouldPoll({ kind: 'relative', durationMs: HOUR }, MINUTE, undefined, new InvalidRequestError('p99 is only available for the last 28 days'))).toBe(false);
  });

  it('keeps polling through a failure that could pass next time, so an outage heals itself', () => {
    expect(shouldPoll({ kind: 'relative', durationMs: HOUR }, MINUTE, undefined, new ServiceUnreachableError('could not reach it'))).toBe(true);
  });

  it('keeps polling a window ending now until its last minutes have arrived', () => {
    // The service answers only up to a few minutes ago, so a window that has just
    // ended is still short of its end, and would stay short without another read.
    const range = { kind: 'absolute' as const, from: NOW - HOUR, to: NOW };

    expect(shouldPoll(range, MINUTE, answer(NOW - HOUR, NOW - 3 * MINUTE, MINUTE), null)).toBe(true);
    expect(shouldPoll(range, MINUTE, answer(NOW - HOUR, NOW, MINUTE), null)).toBe(false);
  });

  it('counts a window as filled when it reaches the last whole bucket, since a part bucket is never returned', () => {
    const range = { kind: 'absolute' as const, from: NOW - HOUR, to: NOW + 2 * MINUTE };

    expect(shouldPoll(range, 5 * MINUTE, answer(NOW - HOUR, NOW, 5 * MINUTE), null)).toBe(false);
  });

  it('leaves a failed read of a filled window to be retried by hand', () => {
    expect(shouldPoll({ kind: 'absolute', from: NOW - HOUR, to: NOW }, MINUTE, undefined, null)).toBe(false);
  });
});

describe('frameOf', () => {
  it('spans the current answers, and ignores stand-ins once any has arrived', () => {
    const frame = frameOf([entry(answer(NOW - HOUR, NOW, MINUTE)), entry(answer(NOW - 24 * HOUR, NOW, 5 * MINUTE), true)]);

    expect(frame).toEqual({ from: NOW - HOUR, to: NOW, periodMs: MINUTE });
  });

  it('takes one stand-in’s window while nothing current has arrived, never a union of several', () => {
    // A day by the minute and a week by the hour would otherwise make a week by the minute: ten thousand buckets.
    const frame = frameOf([entry(answer(NOW - 24 * HOUR, NOW, MINUTE), true), entry(answer(NOW - 7 * 24 * HOUR, NOW, HOUR), true)]);

    expect(frame).toEqual({ from: NOW - 24 * HOUR, to: NOW, periodMs: MINUTE });
  });

  it('has no frame before anything has answered', () => {
    expect(frameOf([entry(undefined)])).toBeUndefined();
  });
});

describe('isDrawableIn', () => {
  it('draws only an answer read at the frame’s period, which alone lands on its buckets', () => {
    const frame = { from: NOW - HOUR, to: NOW, periodMs: 5 * MINUTE };

    expect(isDrawableIn(entry(answer(NOW - HOUR, NOW, 5 * MINUTE)), frame)).toBe(true);
    expect(isDrawableIn(entry(answer(NOW - HOUR, NOW, MINUTE), true), frame)).toBe(false);
    expect(isDrawableIn(entry(undefined), frame)).toBe(false);
  });
});

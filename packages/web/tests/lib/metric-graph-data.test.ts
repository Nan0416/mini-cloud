import type { GetMetricDataResponse, MetricQuery } from '@mini-cloud/shared';
import type { GraphSeries } from '@/hooks/use-metrics';
import { frameOf, isDrawableIn, isFilling } from '@/lib/metric-graph-data';

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

describe('isFilling', () => {
  it('keeps polling a relative window, which moves with the clock', () => {
    expect(isFilling({ kind: 'relative', durationMs: HOUR }, MINUTE, answer(NOW - HOUR, NOW - 3 * MINUTE, MINUTE))).toBe(true);
  });

  it('keeps polling a window ending now until its last minutes have arrived', () => {
    // The service answers only up to a few minutes ago, so a window that has just
    // ended is still short of its end, and would stay short without another read.
    const range = { kind: 'absolute' as const, from: NOW - HOUR, to: NOW };

    expect(isFilling(range, MINUTE, answer(NOW - HOUR, NOW - 3 * MINUTE, MINUTE))).toBe(true);
    expect(isFilling(range, MINUTE, answer(NOW - HOUR, NOW, MINUTE))).toBe(false);
  });

  it('counts a window as filled when it reaches the last whole bucket, since a part bucket is never returned', () => {
    const range = { kind: 'absolute' as const, from: NOW - HOUR, to: NOW + 2 * MINUTE };

    expect(isFilling(range, 5 * MINUTE, answer(NOW - HOUR, NOW, 5 * MINUTE))).toBe(false);
  });

  it('leaves a failed read to be retried by hand rather than every minute', () => {
    expect(isFilling({ kind: 'absolute', from: NOW - HOUR, to: NOW }, MINUTE, undefined)).toBe(false);
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

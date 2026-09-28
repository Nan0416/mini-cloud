import { metricReadWindow, metricResolutionFor } from '../../src/utils/metric-read';

const MINUTE = 60_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 27, 12, 7, 30);

describe('metricReadWindow', () => {
  it('stops where every agent has reported, on a period boundary', () => {
    // 12:07:30 less three minutes is 12:04:30, and the last whole five minutes end at 12:00.
    expect(metricReadWindow({ from: NOW - DAY, periodMs: 5 * MINUTE, now: NOW, queryLagMs: 3 * MINUTE }).to).toBe(Date.UTC(2026, 8, 27, 12, 0));
  });

  it('keeps an earlier end the caller asked for', () => {
    const to = Date.UTC(2026, 8, 27, 10, 0);

    expect(metricReadWindow({ from: NOW - DAY, to, periodMs: MINUTE, now: NOW, queryLagMs: 3 * MINUTE }).to).toBe(to);
  });

  it('floors the start to the period too', () => {
    expect(metricReadWindow({ from: Date.UTC(2026, 8, 27, 9, 3), periodMs: 5 * MINUTE, now: NOW, queryLagMs: 0 }).from).toBe(Date.UTC(2026, 8, 27, 9, 0));
  });
});

describe('metricResolutionFor', () => {
  it('reads the coarsest rollup that fits the period', () => {
    expect(metricResolutionFor({ statistic: 'avg', periodMs: DAY, from: NOW - 30 * DAY, now: NOW, rawRetentionDays: 28 })).toBe('1d');
    expect(metricResolutionFor({ statistic: 'avg', periodMs: 5 * MINUTE, from: NOW - DAY, now: NOW, rawRetentionDays: 28 })).toBe('1m');
  });

  it('reads a percentile from minutes, and refuses one older than raw retention', () => {
    expect(metricResolutionFor({ statistic: 'p99', periodMs: DAY, from: NOW - 7 * DAY, now: NOW, rawRetentionDays: 28 })).toBe('1m');
    expect(() => metricResolutionFor({ statistic: 'p99', periodMs: DAY, from: NOW - 30 * DAY, now: NOW, rawRetentionDays: 28 })).toThrow(/only available for the last 28 days/);
  });
});

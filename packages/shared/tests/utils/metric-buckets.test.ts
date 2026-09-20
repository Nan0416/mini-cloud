import { coarsestResolutionFor, floorToPeriod, floorToResolution } from '../../src/utils/metric-buckets';

describe('floorToResolution', () => {
  it('floors to the start of the minute', () => {
    expect(floorToResolution(Date.UTC(2026, 8, 19, 14, 30, 45, 123), '1m')).toBe(Date.UTC(2026, 8, 19, 14, 30));
  });

  it('floors to the start of the UTC hour', () => {
    expect(floorToResolution(Date.UTC(2026, 8, 19, 14, 30), '1h')).toBe(Date.UTC(2026, 8, 19, 14));
  });

  it('floors to the start of the UTC day', () => {
    expect(floorToResolution(Date.UTC(2026, 8, 19, 14, 30), '1d')).toBe(Date.UTC(2026, 8, 19));
  });

  it('leaves a timestamp already on a boundary alone', () => {
    const boundary = Date.UTC(2026, 8, 19);

    expect(floorToResolution(boundary, '1d')).toBe(boundary);
  });

  it('agrees whatever the machine timezone, because the epoch is midnight UTC', () => {
    // The agent floors to the minute and the service to the hour and day. If those
    // two disagreed about where a boundary is, one series would split in two.
    const timestamp = Date.UTC(2026, 8, 19, 23, 59, 59, 999);

    expect(floorToResolution(floorToResolution(timestamp, '1m'), '1d')).toBe(floorToResolution(timestamp, '1d'));
  });
});

describe('floorToPeriod', () => {
  it('floors to a five-minute boundary', () => {
    expect(floorToPeriod(Date.UTC(2026, 8, 19, 14, 32), 300_000)).toBe(Date.UTC(2026, 8, 19, 14, 30));
  });
});

describe('coarsestResolutionFor', () => {
  it('reads a day of data from the daily rollup', () => {
    // Otherwise a year-long chart would scan half a million minute rows.
    expect(coarsestResolutionFor(86_400_000)).toBe('1d');
  });

  it('reads an hour-wide period from the hourly rollup', () => {
    expect(coarsestResolutionFor(3_600_000)).toBe('1h');
  });

  it('falls back to minutes for a period the rollups do not divide', () => {
    // A five-minute bucket built from hourly rows would each be a twelfth of a row.
    expect(coarsestResolutionFor(300_000)).toBe('1m');
    expect(coarsestResolutionFor(60_000)).toBe('1m');
  });

  it('uses the daily rollup for a whole number of days', () => {
    expect(coarsestResolutionFor(7 * 86_400_000)).toBe('1d');
  });

  it('uses hours for a period that is a multiple of an hour but not a day', () => {
    expect(coarsestResolutionFor(6 * 3_600_000)).toBe('1h');
  });
});

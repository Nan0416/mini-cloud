import type { MetricAxis, MetricUnit } from '@mini-cloud/shared';
import { buildChartModel, formatBucket, formatTimeTick, nearestBucket, type ChartModelInput, type ChartSeries } from '@/lib/chart-model';

const MINUTE = 60_000;
const FROM = Date.UTC(2026, 8, 20, 12, 0);
const GB = 1024 ** 3;

function aSeries(values: ReadonlyArray<number | undefined>, overrides: Partial<ChartSeries> = {}): ChartSeries {
  const datapoints = values.flatMap((value, index) => (value === undefined ? [] : [{ timestamp: FROM + index * MINUTE, value }]));
  return { id: 'm1', unit: 'Count', axis: 'left', datapoints, ...overrides };
}

function build(series: ReadonlyArray<ChartSeries>, overrides: Partial<ChartModelInput> = {}) {
  return buildChartModel({ series, from: FROM, to: FROM + 10 * MINUTE, periodMs: MINUTE, width: 800, height: 260, locale: 'en-US', ...overrides });
}

const on = (axis: MetricAxis, unit: MetricUnit, id: string, values: ReadonlyArray<number | undefined>): ChartSeries => aSeries(values, { id, unit, axis });

describe('buildChartModel', () => {
  it('spans the window, not the data, so a series that started late is drawn late', () => {
    // Plotting against the data's own extent stretched ten minutes across a whole day.
    const model = build([aSeries([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 5, 6])]);

    expect(model.buckets).toHaveLength(10);
    expect(model.xs[0]).toBe(model.plot.left);
    expect(model.xs[9]).toBe(model.plot.right);
    expect(model.series[0].ys.slice(0, 8)).toEqual(Array(8).fill(undefined));
  });

  it('files each datapoint under its own bucket', () => {
    const model = build([aSeries([1, undefined, 3])]);

    expect(model.series[0].values.slice(0, 3)).toEqual([1, undefined, 3]);
  });

  it('breaks the line where a series reported nothing, rather than drawing across the gap', () => {
    // An agent down for two hours used to look like a smooth line through the outage.
    const model = build([aSeries([1, 2, undefined, undefined, 5, 6])]);

    expect(model.series[0].line.match(/M/g)).toHaveLength(2);
  });

  it('draws a datapoint with a gap on each side as a dot, which a line cannot show', () => {
    const model = build([aSeries([1, 2, undefined, 4, undefined, 6, 7])]);

    expect(model.series[0].dots).toEqual([{ x: model.xs[3], y: model.series[0].ys[3] }]);
  });

  it('draws a single datapoint in the middle of the chart', () => {
    const model = build([aSeries([4])], { to: FROM + MINUTE });

    expect(model.series[0].dots).toHaveLength(1);
    expect(model.xs[0]).toBeCloseTo((model.plot.left + model.plot.right) / 2);
  });

  it('labels ticks in the unit they are read in, stepping by round amounts of it', () => {
    const model = build([aSeries([0.2 * GB, 1.4 * GB], { unit: 'Bytes' })]);

    expect(model.axes[0].ticks.map((tick) => tick.label)).toEqual(['0.0 GB', '0.2 GB', '0.4 GB', '0.6 GB', '0.8 GB', '1.0 GB', '1.2 GB', '1.4 GB']);
  });

  it('always shows zero, so a small change is not drawn as a cliff', () => {
    const model = build([aSeries([95, 97, 96], { unit: 'Percent' })]);

    expect(model.axes[0].ticks[0].label).toBe('0%');
  });

  it('gives a flat series a range to be drawn in', () => {
    const model = build([aSeries([0, 0, 0])]);

    expect(model.series[0].ys.slice(0, 3).every((y) => y !== undefined && Number.isFinite(y))).toBe(true);
  });

  it('puts series of one quantity on one axis, converting between their units', () => {
    const model = build([on('left', 'Kilobytes', 'm1', [1024]), on('left', 'Megabytes', 'm2', [1])]);

    expect(model.axes[0].units).toEqual(['Kilobytes']);
    expect(model.series[1].ys[0]).toBeCloseTo(model.series[0].ys[0] ?? Number.NaN);
  });

  it('owns up to an axis whose series measure different things', () => {
    const model = build([on('left', 'Percent', 'm1', [50]), on('left', 'Bytes', 'm2', [GB])]);

    expect(model.axes[0].units).toEqual(['Percent', 'Bytes']);
    expect(model.axes[0].ticks.some((tick) => tick.label.includes('%') || tick.label.includes('B'))).toBe(false);
  });

  it('scales a series on the right against the right axis alone', () => {
    const model = build([on('left', 'Percent', 'm1', [100]), on('right', 'Bytes', 'm2', [GB])]);

    expect(model.axes.map((axis) => axis.side)).toEqual(['left', 'right']);
    // Each reaches the top of its own axis, which one shared scale could not do.
    expect(model.series[0].ys[0]).toBeCloseTo(model.plot.top);
    expect(model.series[1].ys[0]).toBeCloseTo(model.plot.top);
    expect(model.plot.right).toBeLessThan(800 - 20);
  });

  it('draws gridlines for one axis only, since two sets would cross', () => {
    const model = build([on('left', 'Percent', 'm1', [100]), on('right', 'Bytes', 'm2', [3 * GB])]);

    expect(model.gridlines).toEqual(model.axes[0].ticks.map((tick) => tick.position));
  });

  it('draws only a right axis when nothing is on the left', () => {
    const model = build([on('right', 'Percent', 'm1', [50])]);

    expect(model.axes.map((axis) => axis.side)).toEqual(['right']);
  });

  it('washes the area under a lone series, and under none when there are several', () => {
    expect(build([aSeries([1, 2])]).series[0].area).toBeDefined();
    expect(build([on('left', 'Count', 'm1', [1, 2]), on('left', 'Count', 'm2', [2, 3])]).series.map((series) => series.area)).toEqual([undefined, undefined]);
  });

  it('sizes the margin beside an axis to its longest label', () => {
    const narrow = build([aSeries([1])]);
    const wide = build([aSeries([123_456.78], { unit: 'Milliseconds' })]);

    expect(wide.plot.left).toBeGreaterThan(narrow.plot.left);
  });

  it('keeps time labels at the edges inside the chart', () => {
    const model = build([aSeries([1])], { to: FROM + 600 * MINUTE, periodMs: MINUTE });

    for (const tick of model.xTicks) {
      if (tick.position - model.plot.left < 30) {
        expect(tick.anchor).toBe('start');
      }
    }
    expect(model.xTicks.length).toBeGreaterThan(1);
  });

  it('never sets two time labels on top of each other, even where a month ends', () => {
    // Four weeks spanning a month end: d3's two-day ticks land on the 31st and the 1st.
    const from = new Date(2026, 7, 23).getTime();
    const model = build([aSeries([1])], { from, to: from + 28 * 86_400_000, periodMs: 3 * 3_600_000, width: 1000 });

    const gaps = model.xTicks.slice(1).map((tick, index) => tick.position - model.xTicks[index].position);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(60);
  });

  it('has nothing to draw for an empty window, and does not fail on one', () => {
    const model = build([aSeries([])], { to: FROM });

    expect(model.buckets).toEqual([]);
    expect(nearestBucket(model, 100)).toBeUndefined();
  });
});

describe('nearestBucket', () => {
  it('snaps to the closest bucket, so the reader aims at a time and not at a line', () => {
    const model = build([aSeries([1, 2, 3])]);
    const between = model.xs[1] + (model.xs[2] - model.xs[1]) * 0.4;

    expect(nearestBucket(model, between)).toBe(1);
    expect(nearestBucket(model, -1000)).toBe(0);
    expect(nearestBucket(model, 10_000)).toBe(9);
  });
});

describe('formatTimeTick', () => {
  // Local dates, because ticks fall on the viewer's midnights and not on UTC's.
  it('gives the time of day for a tick within a day, on the 24-hour clock the console uses', () => {
    expect(formatTimeTick(new Date(2026, 8, 20, 14, 30), 'en-US')).toBe('14:30');
  });

  it('gives the date at midnight', () => {
    expect(formatTimeTick(new Date(2026, 8, 20), 'en-US')).toBe('Sep 20');
  });

  it('gives the month on its first day, and the year on the first of January', () => {
    expect(formatTimeTick(new Date(2026, 8, 1), 'en-US')).toBe('Sep');
    expect(formatTimeTick(new Date(2027, 0, 1), 'en-US')).toBe('2027');
  });
});

describe('formatBucket', () => {
  it('gives the date and time a bucket starts', () => {
    expect(formatBucket(new Date(2026, 8, 20, 14, 5).getTime(), 'en-US')).toBe('Sep 20, 2026, 14:05');
  });

  it('keeps the time for a daily bucket, whose midnight is UTC and not the viewer’s', () => {
    expect(formatBucket(Date.UTC(2026, 8, 20), 'en-US')).toMatch(/\d\d:\d\d$/);
  });
});

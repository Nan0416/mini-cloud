import type { MetricQuery } from '@mini-cloud/shared';
import { EMPTY_GRAPH, axisFor, axisUnitsOf, colorsOf, labelOf, nextColor, nextQueryId, periodFits, withRange } from '@/lib/metric-graph-editor';

const HOUR = 3_600_000;
const DAY = 86_400_000;

function aQuery(overrides: Partial<MetricQuery> = {}): MetricQuery {
  return { id: 'm1', namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'avg', ...overrides };
}

describe('nextQueryId', () => {
  it('takes the first free number, so a removed id is reused before a new one is made', () => {
    expect(nextQueryId([])).toBe('m1');
    expect(nextQueryId([aQuery({ id: 'm1' }), aQuery({ id: 'm3' })])).toBe('m2');
    expect(nextQueryId([aQuery({ id: 'cpu' })])).toBe('m1');
  });
});

describe('colorsOf', () => {
  it('keeps a query’s own colour, so removing another series does not repaint it', () => {
    const before = [aQuery({ id: 'm1', color: 1 }), aQuery({ id: 'm2', color: 2 }), aQuery({ id: 'm3', color: 3 })];
    const after = before.filter((query) => query.id !== 'm2');

    expect(colorsOf(after)).toEqual([1, 3]);
  });

  it('gives a query without one the first colour nobody holds', () => {
    expect(colorsOf([aQuery({ id: 'm1' }), aQuery({ id: 'm2', color: 1 }), aQuery({ id: 'm3' })])).toEqual([2, 1, 3]);
  });
});

describe('nextColor', () => {
  it('hands a new query the first colour not already drawn', () => {
    expect(nextColor([])).toBe(1);
    expect(nextColor([aQuery({ id: 'm1', color: 1 }), aQuery({ id: 'm2', color: 3 })])).toBe(2);
    expect(nextColor([aQuery({ id: 'm1' }), aQuery({ id: 'm2' })])).toBe(3);
  });
});

describe('labelOf', () => {
  it('uses the query’s own label when it has one', () => {
    expect(labelOf(aQuery({ label: 'CPU on the NAS' }))).toBe('CPU on the NAS');
  });

  it('otherwise names the metric, its dimension values and the statistic', () => {
    expect(labelOf(aQuery({ statistic: 'p99' }))).toBe('CpuUtilization · nas · p99');
    expect(labelOf(aQuery({ dimensions: {} }))).toBe('CpuUtilization · avg');
  });
});

describe('axisFor', () => {
  it('starts on the left', () => {
    expect(axisFor('Percent', axisUnitsOf([]))).toBe('left');
  });

  it('joins the axis that already reads its kind of unit', () => {
    const units = axisUnitsOf([
      { axis: 'left', unit: 'Percent' },
      { axis: 'right', unit: 'Bytes' },
    ]);

    expect(axisFor('Megabytes', units)).toBe('right');
    expect(axisFor('Percent', units)).toBe('left');
  });

  it('takes the empty axis for a second kind of unit', () => {
    expect(axisFor('Bytes', axisUnitsOf([{ axis: 'left', unit: 'Percent' }]))).toBe('right');
  });

  it('has no axis for a third kind of unit', () => {
    const units = axisUnitsOf([
      { axis: 'left', unit: 'Percent' },
      { axis: 'right', unit: 'Bytes' },
    ]);

    expect(axisFor('Milliseconds', units)).toBeUndefined();
  });
});

describe('axisUnitsOf', () => {
  it('counts units that convert into each other once', () => {
    const units = axisUnitsOf([
      { axis: 'left', unit: 'Kilobytes' },
      { axis: 'left', unit: 'Megabytes' },
    ]);

    expect(units.left).toEqual(['Kilobytes']);
  });
});

describe('withRange', () => {
  it('keeps a chosen period the new range can still be read at', () => {
    const graph = { ...EMPTY_GRAPH, periodMs: HOUR };

    expect(withRange(graph, { kind: 'relative', durationMs: 7 * DAY }).periodMs).toBe(HOUR);
  });

  it('drops a chosen period the new range has outgrown, rather than have every series refused', () => {
    const graph = { ...EMPTY_GRAPH, periodMs: 60_000 };

    expect(withRange(graph, { kind: 'relative', durationMs: 28 * DAY }).periodMs).toBeUndefined();
  });
});

describe('periodFits', () => {
  it('allows exactly as many datapoints as one read may return', () => {
    expect(periodFits(DAY, 60_000)).toBe(true);
    expect(periodFits(DAY + 60_000, 60_000)).toBe(false);
  });
});

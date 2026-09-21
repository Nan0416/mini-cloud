import { METRIC_MAX_DATAPOINTS } from '../../src/models/metric';
import { MetricGraph } from '../../src/models/metric-graph';
import { coarsestResolutionFor } from '../../src/utils/metric-buckets';
import { autoPeriodFor, parseMetricGraph, periodOf, spanOf } from '../../src/utils/metric-graph';

const HOUR = 3_600_000;
const DAY = 86_400_000;

function aQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    namespace: 'MiniCloud/Agent',
    metricName: 'CpuUtilization',
    dimensions: { AgentId: 'nas' },
    statistic: 'avg',
    ...overrides,
  };
}

function aGraph(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    queries: [aQuery()],
    range: { kind: 'relative', durationMs: 3 * HOUR },
    ...overrides,
  };
}

describe('parseMetricGraph', () => {
  it('accepts a graph and returns the same graph', () => {
    const graph = aGraph({
      queries: [aQuery(), aQuery({ id: 'm2', statistic: 'p99', label: 'CPU p99', color: 3, yAxis: 'right' })],
      range: { kind: 'absolute', from: Date.UTC(2026, 8, 1), to: Date.UTC(2026, 8, 2) },
      periodMs: 300_000,
    });

    expect(parseMetricGraph(graph)).toEqual(graph);
  });

  it('survives a trip through JSON unchanged', () => {
    // What a link and a stored dashboard both do to it.
    const parsed = parseMetricGraph(aGraph());

    expect(parseMetricGraph(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('accepts a graph with no queries, which is where a new one starts', () => {
    expect(parseMetricGraph(aGraph({ queries: [] })).queries).toEqual([]);
  });

  it('accepts the empty dimension set, which is a series of its own', () => {
    expect(parseMetricGraph(aGraph({ queries: [aQuery({ dimensions: {} })] })).queries[0].dimensions).toEqual({});
  });

  it('refuses any version but the one it reads, before complaining about fields', () => {
    // A newer graph's unknown fields are a symptom; the version is the cause.
    expect(() => parseMetricGraph(aGraph({ version: 2, legend: 'bottom' }))).toThrow(/graph.version must be 1/);
    expect(() => parseMetricGraph({ queries: [] })).toThrow(/graph.version must be 1/);
  });

  it('refuses a field it does not define, so a typo is not silently ignored', () => {
    expect(() => parseMetricGraph(aGraph({ queries: [aQuery({ lable: 'CPU' })] }))).toThrow(/graph.queries\[0\].lable is not a field/);
    expect(() => parseMetricGraph(aGraph({ period: 60_000 }))).toThrow(/graph.period is not a field/);
    expect(() => parseMetricGraph(aGraph({ range: { kind: 'relative', durationMs: HOUR, from: 0 } }))).toThrow(/graph.range.from is not a field/);
  });

  it('names the path of the field that is wrong', () => {
    expect(() => parseMetricGraph(aGraph({ queries: [aQuery(), aQuery({ id: 'm2', statistic: 'median' })] }))).toThrow(/graph.queries\[1\].statistic must be one of/);
  });

  it('refuses two queries with one id', () => {
    // The id is the React key, the colour and, later, an expression's name for it.
    expect(() => parseMetricGraph(aGraph({ queries: [aQuery(), aQuery()] }))).toThrow(/"m1" is already used/);
  });

  it('refuses an id an expression could not name', () => {
    for (const id of ['M1', '1m', 'm-1', 'm 1', 'a'.repeat(256)]) {
      expect(() => parseMetricGraph(aGraph({ queries: [aQuery({ id })] }))).toThrow(/must start with a lowercase letter/);
    }
  });

  it('refuses more queries than one graph may plot', () => {
    const queries = (length: number) => Array.from({ length }, (_, index) => aQuery({ id: `m${index}` }));

    expect(parseMetricGraph(aGraph({ queries: queries(8) })).queries).toHaveLength(8);
    expect(() => parseMetricGraph(aGraph({ queries: queries(9) }))).toThrow(/more than the 8/);
  });

  it('refuses a colour the console does not have', () => {
    for (const color of [0, 9, 1.5, '1']) {
      expect(() => parseMetricGraph(aGraph({ queries: [aQuery({ color })] }))).toThrow(/color must be/);
    }
  });

  it('refuses an empty label rather than drawing a blank legend entry', () => {
    expect(() => parseMetricGraph(aGraph({ queries: [aQuery({ label: '' })] }))).toThrow(/leave it out for the default/);
  });

  it('requires a dimension set, even an empty one', () => {
    expect(() => parseMetricGraph(aGraph({ queries: [aQuery({ dimensions: undefined })] }))).toThrow(/dimensions must be an object/);
    expect(() => parseMetricGraph(aGraph({ queries: [aQuery({ dimensions: { AgentId: 7 } })] }))).toThrow(/dimensions.AgentId must be a string/);
  });

  it('refuses an absolute range that ends before it starts', () => {
    expect(() => parseMetricGraph(aGraph({ range: { kind: 'absolute', from: 2000, to: 1000 } }))).toThrow(/from must be before graph.range.to/);
    expect(() => parseMetricGraph(aGraph({ range: { kind: 'absolute', from: 1000, to: 1000 } }))).toThrow(/from must be before/);
  });

  it('refuses a time no Date can hold, because formatting it would throw', () => {
    expect(() => parseMetricGraph(aGraph({ range: { kind: 'absolute', from: 0, to: 1e300 } }))).toThrow(/graph.range.to must be between/);
    expect(() => parseMetricGraph(aGraph({ range: { kind: 'relative', durationMs: 1e300 } }))).toThrow(/durationMs must be between/);
  });

  it('refuses a relative range that is not a positive span', () => {
    expect(() => parseMetricGraph(aGraph({ range: { kind: 'relative', durationMs: 0 } }))).toThrow(/durationMs must be positive/);
  });

  it('refuses a period that is not a whole number of minutes, as the service would', () => {
    expect(() => parseMetricGraph(aGraph({ periodMs: 90_000 }))).toThrow(/whole number of minutes/);
    expect(() => parseMetricGraph(aGraph({ periodMs: 0 }))).toThrow(/whole number of minutes/);
  });

  it('refuses something that is not a graph at all', () => {
    expect(() => parseMetricGraph([])).toThrow(/graph must be an object/);
    expect(() => parseMetricGraph(null)).toThrow(/graph must be an object/);
  });
});

describe('autoPeriodFor', () => {
  it('reads an hour by the minute', () => {
    expect(autoPeriodFor(HOUR)).toBe(60_000);
  });

  it('coarsens only as far as it has to', () => {
    // A day by the minute is 1440 points; five minutes is the first that fits.
    expect(autoPeriodFor(DAY)).toBe(300_000);
    expect(autoPeriodFor(7 * DAY)).toBe(HOUR);
  });

  it('gives every range a whole number of minutes, well within what one read may return', () => {
    for (const span of [60_000, HOUR, 6 * HOUR, DAY, 3 * DAY, 7 * DAY, 30 * DAY, 90 * DAY, 365 * DAY, 5 * 365 * DAY]) {
      const period = autoPeriodFor(span);

      expect(period % 60_000).toBe(0);
      expect(Math.ceil(span / period)).toBeLessThanOrEqual(METRIC_MAX_DATAPOINTS);
    }
  });

  it('reads a week or more from a rollup rather than from minutes', () => {
    for (const span of [7 * DAY, 30 * DAY, 365 * DAY, 5 * 365 * DAY]) {
      expect(coarsestResolutionFor(autoPeriodFor(span))).not.toBe('1m');
    }
  });

  it('uses whole days past the longest candidate', () => {
    expect(autoPeriodFor(5 * 365 * DAY) % DAY).toBe(0);
  });
});

describe('periodOf', () => {
  const graph = (overrides: Partial<MetricGraph>): MetricGraph => ({ version: 1, queries: [], range: { kind: 'relative', durationMs: DAY }, ...overrides });

  it('uses the graph’s own period when it has one', () => {
    expect(periodOf(graph({ periodMs: HOUR }))).toBe(HOUR);
  });

  it('chooses one from the range when it does not', () => {
    expect(periodOf(graph({}))).toBe(autoPeriodFor(DAY));
    expect(periodOf(graph({ range: { kind: 'absolute', from: 0, to: 7 * DAY } }))).toBe(autoPeriodFor(7 * DAY));
  });
});

describe('spanOf', () => {
  it('measures either kind of range', () => {
    expect(spanOf({ kind: 'relative', durationMs: HOUR })).toBe(HOUR);
    expect(spanOf({ kind: 'absolute', from: 1000, to: 5000 })).toBe(4000);
  });
});

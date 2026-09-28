import { METRIC_STATISTICS, hashDimensions, type MonitorDefinition, type MonitorMetric } from '@mini-cloud/shared';
import {
  blankMonitorForm,
  defaultMonitorWindow,
  definitionOf,
  describeCondition,
  maxEvaluationPeriods,
  metricFromSearch,
  metricSearch,
  monitorFormOf,
  monitorGraph,
} from '@/lib/monitor-editor';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const aMetric = (overrides: Partial<MonitorMetric> = {}): MonitorMetric => ({
  namespace: 'MiniCloud/Agent',
  metricName: 'CpuUtilization',
  dimensions: { AgentId: 'nas' },
  statistic: 'p99',
  ...overrides,
});

const aDefinition = (overrides: Partial<MonitorDefinition> = {}): MonitorDefinition => ({
  metric: aMetric(),
  periodMs: 5 * MINUTE,
  evaluationPeriods: 5,
  datapointsToAlarm: 3,
  comparison: 'GreaterThanThreshold',
  threshold: 80,
  treatMissingData: 'missing',
  notify: true,
  ...overrides,
});

describe('describeCondition', () => {
  it('reads as the rule it is', () => {
    expect(describeCondition(aDefinition())).toBe('p99 > 80 for 3 of 5 periods of 5 minutes');
    expect(describeCondition(aDefinition({ datapointsToAlarm: 5, comparison: 'LessThanOrEqualToThreshold' }))).toBe('p99 ≤ 80 for all 5 periods of 5 minutes');
    expect(describeCondition(aDefinition({ evaluationPeriods: 1, datapointsToAlarm: 1, periodMs: HOUR }))).toBe('p99 > 80 for 1 period of 1 hour');
  });
});

describe('defaultMonitorWindow', () => {
  it('reads at the monitor’s own period, so the chart shows the buckets it judges', () => {
    expect(defaultMonitorWindow(aDefinition()).periodMs).toBe(5 * MINUTE);
  });

  it('shows the evaluation window in context, never less than three hours nor more than a week', () => {
    expect(defaultMonitorWindow(aDefinition({ periodMs: MINUTE, evaluationPeriods: 1 })).range).toEqual({ kind: 'relative', durationMs: 3 * HOUR });
    expect(defaultMonitorWindow(aDefinition({ periodMs: HOUR, evaluationPeriods: 3 })).range).toEqual({ kind: 'relative', durationMs: 60 * HOUR });
    expect(defaultMonitorWindow(aDefinition({ periodMs: DAY, evaluationPeriods: 1 })).range).toEqual({ kind: 'relative', durationMs: 7 * DAY });
  });
});

describe('monitorGraph', () => {
  it('draws the monitored series alone, in the first colour', () => {
    const graph = monitorGraph(aMetric(), { range: { kind: 'relative', durationMs: HOUR }, periodMs: MINUTE });

    expect(graph.queries).toEqual([{ id: 'm1', namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'p99', color: 1 }]);
    expect(graph.periodMs).toBe(MINUTE);
  });
});

describe('definitionOf', () => {
  it('turns a monitor’s form back into the same monitor', () => {
    expect(definitionOf(monitorFormOf(aDefinition({ description: 'CPU' })))).toEqual({ definition: aDefinition({ description: 'CPU' }) });
  });

  it('asks for a metric and a threshold before anything else', () => {
    expect(definitionOf(blankMonitorForm()).problem).toBe('Choose a metric to watch.');
    expect(definitionOf(blankMonitorForm(aMetric())).problem).toBe('Enter a threshold.');
  });

  it('holds the form to the service’s rules, naming fields as the form labels them', () => {
    const form = { ...monitorFormOf(aDefinition()), datapointsToAlarm: '6' };

    expect(definitionOf(form).problem).toMatch(/^Datapoints to alarm must be from 1 to evaluationPeriods/);
  });

  it('refuses a threshold that is not a number rather than reading it as zero', () => {
    expect(definitionOf({ ...monitorFormOf(aDefinition()), threshold: 'high' }).problem).toMatch(/Threshold/);
  });
});

describe('maxEvaluationPeriods', () => {
  it('keeps the window within a day', () => {
    expect(maxEvaluationPeriods(MINUTE)).toBe(1440);
    expect(maxEvaluationPeriods(6 * HOUR)).toBe(4);
  });
});

describe('metricSearch and metricFromSearch', () => {
  it('carry a metric through a link, dimensions and all', () => {
    const metric = aMetric({ dimensions: { AgentId: 'nas', Mount: '/data:1' } });

    expect(metricFromSearch(new URLSearchParams(metricSearch(metric)), METRIC_STATISTICS)).toEqual(metric);
  });

  it('seed a new form on the metric, as the metrics page links to it', () => {
    const form = blankMonitorForm(metricFromSearch(new URLSearchParams(metricSearch(aMetric())), METRIC_STATISTICS));

    expect(form).toMatchObject({ namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensionsHash: hashDimensions({ AgentId: 'nas' }), statistic: 'p99' });
  });

  it('name no metric when the link names only part of one', () => {
    expect(metricFromSearch(new URLSearchParams('namespace=A&metric=B'), METRIC_STATISTICS)).toBeUndefined();
    expect(metricFromSearch(new URLSearchParams('namespace=A&metric=B&statistic=median'), METRIC_STATISTICS)).toBeUndefined();
  });
});

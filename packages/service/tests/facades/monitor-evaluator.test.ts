import { LoggerFactory, Monitor, MetricDatapoint } from '@mini-cloud/shared';
import { MetricDao, ReadSeriesInput, ReadSeriesOutput } from '../../src/data/metric-dao';
import { AlarmNotification, AlarmNotifier } from '../../src/facades/alarm-notifier';
import { MonitorEvaluator } from '../../src/facades/monitor-evaluator';
import { FakeMonitorDao } from '../data/fake-daos';

const MINUTE = 60_000;
const LAG = 3 * MINUTE;
// On a five-minute boundary plus a little, so the arithmetic below reads plainly.
const NOW = Date.UTC(2026, 8, 27, 12, 0, 30);

/** Answers a read from a fixed series, and records what it was asked. */
class FakeSeries {
  readonly reads: ReadSeriesInput[] = [];
  datapoints: MetricDatapoint[] = [];
  failWith: Error | undefined = undefined;

  readSeries = async (input: ReadSeriesInput): Promise<ReadSeriesOutput> => {
    this.reads.push(input);
    if (this.failWith !== undefined) {
      throw this.failWith;
    }
    return { unit: 'Percent', datapoints: this.datapoints.filter((datapoint) => datapoint.timestamp >= input.from && datapoint.timestamp < input.to) };
  };

  asDao(): MetricDao {
    return this as unknown as MetricDao;
  }
}

class RecordingNotifier implements AlarmNotifier {
  readonly sent: AlarmNotification[] = [];
  failWith: Error | undefined = undefined;

  async notify(notification: AlarmNotification): Promise<void> {
    if (this.failWith !== undefined) {
      throw this.failWith;
    }
    this.sent.push(notification);
  }
}

const aMonitor = (overrides: Partial<Monitor> = {}): Monitor => ({
  name: 'nas-cpu',
  metric: { namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'avg' },
  periodMs: 5 * MINUTE,
  evaluationPeriods: 3,
  datapointsToAlarm: 2,
  comparison: 'GreaterThanThreshold',
  threshold: 80,
  treatMissingData: 'missing',
  notify: true,
  state: 'OK',
  stateReason: 'fine',
  stateChangedAt: 0,
  version: 1,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

/** The last closed five-minute period ends at 11:55: 12:00:30 less the lag, floored. */
const WINDOW_END = Date.UTC(2026, 8, 27, 11, 55);

const context = (...monitors: Monitor[]) => {
  const monitorDao = new FakeMonitorDao().seed(...monitors);
  const series = new FakeSeries();
  const notifier = new RecordingNotifier();
  const evaluator = new MonitorEvaluator({ monitorDao, metricDao: series.asDao(), notifier, config: { tickMs: MINUTE, queryLagMs: LAG, rawRetentionDays: 28 } });
  return { monitorDao, series, notifier, evaluator };
};

/** Values for the window's periods, oldest first. */
const valuesEndingAt = (end: number, ...values: number[]): MetricDatapoint[] => values.map((value, index) => ({ timestamp: end - (values.length - index) * 5 * MINUTE, value }));

beforeAll(() => {
  // Failures below are on purpose; their stack traces would only be noise.
  jest.spyOn(LoggerFactory.getLogger('MonitorEvaluator'), 'error').mockImplementation(() => {});
});

describe('MonitorEvaluator', () => {
  it('reads the last N closed periods, ending where every agent has reported', async () => {
    const { series, evaluator } = context(aMonitor());

    await evaluator.runTick(NOW);

    expect(series.reads).toHaveLength(1);
    expect(series.reads[0]).toMatchObject({ from: WINDOW_END - 15 * MINUTE, to: WINDOW_END, periodMs: 5 * MINUTE, statistic: 'avg', limit: 3, resolution: '1m' });
  });

  it('records a change of state with its reason and datapoints, and notifies it', async () => {
    const { series, monitorDao, notifier, evaluator } = context(aMonitor());
    series.datapoints = valuesEndingAt(WINDOW_END, 50, 90, 95);

    await evaluator.runTick(NOW);

    expect(monitorDao.monitors.get('nas-cpu')?.state).toBe('ALARM');
    expect(monitorDao.changes).toHaveLength(1);
    expect(monitorDao.changes[0]).toMatchObject({ fromState: 'OK', toState: 'ALARM', threshold: 80, changedAt: NOW });
    expect(monitorDao.changes[0].datapoints.map((datapoint) => datapoint.value)).toEqual([50, 90, 95]);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].monitor.state).toBe('ALARM');
  });

  it('records nothing and notifies no one when the state holds, but marks the evaluation', async () => {
    const { series, monitorDao, notifier, evaluator } = context(aMonitor());
    series.datapoints = valuesEndingAt(WINDOW_END, 50, 60, 70);

    await evaluator.runTick(NOW);

    expect(monitorDao.changes).toHaveLength(0);
    expect(notifier.sent).toHaveLength(0);
    expect(monitorDao.monitors.get('nas-cpu')?.lastEvaluatedAt).toBe(NOW);
  });

  it('records a change without notifying for a monitor that does not notify', async () => {
    const { series, monitorDao, notifier, evaluator } = context(aMonitor({ notify: false }));
    series.datapoints = valuesEndingAt(WINDOW_END, 90, 90, 90);

    await evaluator.runTick(NOW);

    expect(monitorDao.changes).toHaveLength(1);
    expect(notifier.sent).toHaveLength(0);
  });

  it('notifies each change once across ticks, not on every tick the state holds', async () => {
    const { series, notifier, evaluator } = context(aMonitor());
    series.datapoints = valuesEndingAt(WINDOW_END, 90, 90, 90);

    await evaluator.runTick(NOW);
    await evaluator.runTick(NOW + MINUTE);

    expect(notifier.sent).toHaveLength(1);
  });

  it('keeps the change recorded when the notifier fails', async () => {
    const { series, monitorDao, notifier, evaluator } = context(aMonitor());
    series.datapoints = valuesEndingAt(WINDOW_END, 90, 90, 90);
    notifier.failWith = new Error('discord is down');

    await evaluator.runTick(NOW);

    expect(monitorDao.monitors.get('nas-cpu')?.state).toBe('ALARM');
    expect(monitorDao.changes).toHaveLength(1);
  });

  it('evaluates every other monitor when one cannot be read', async () => {
    const { series, monitorDao, evaluator } = context(aMonitor({ name: 'a' }), aMonitor({ name: 'b' }));
    series.datapoints = valuesEndingAt(WINDOW_END, 90, 90, 90);
    const read = series.readSeries;
    series.readSeries = async (input) => {
      if (series.reads.length === 0) {
        series.reads.push(input);
        throw new Error('connection reset');
      }
      return read(input);
    };

    await evaluator.runTick(NOW);

    expect(monitorDao.monitors.get('a')?.state).toBe('OK');
    expect(monitorDao.monitors.get('b')?.state).toBe('ALARM');
  });

  it('records and notifies nothing judged against a threshold that was raised while it was being judged', async () => {
    const { series, monitorDao, notifier, evaluator } = context(aMonitor());
    series.datapoints = valuesEndingAt(WINDOW_END, 90, 90, 90);
    const read = series.readSeries;
    series.readSeries = async (input) => {
      // The operator raises the threshold to 95 after this tick loaded the monitor at 80.
      await monitorDao.updateMonitor({ ...aMonitor(), version: 1, threshold: 95 });
      return read(input);
    };

    await evaluator.runTick(NOW);

    expect(monitorDao.monitors.get('nas-cpu')?.state).toBe('OK');
    expect(monitorDao.changes).toHaveLength(0);
    expect(notifier.sent).toHaveLength(0);
  });

  it('records nothing when the monitor moved on while it was being judged', async () => {
    const { series, monitorDao, notifier, evaluator } = context(aMonitor());
    series.datapoints = valuesEndingAt(WINDOW_END, 90, 90, 90);
    const read = series.readSeries;
    series.readSeries = async (input) => {
      // An edit or a delete landing between the read and the write.
      monitorDao.monitors.delete('nas-cpu');
      return read(input);
    };

    await evaluator.runTick(NOW);

    expect(monitorDao.changes).toHaveLength(0);
    expect(notifier.sent).toHaveLength(0);
  });
});

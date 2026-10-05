import { Monitor, MonitorStateChange } from '@mini-cloud/shared';
import { alarmMessage, monitorLink, testMessage } from '../../src/utils/notification-message';

const aMonitor = (overrides: Partial<Monitor> = {}): Monitor => ({
  name: 'nas-cpu',
  metric: { namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'avg' },
  periodMs: 300_000,
  evaluationPeriods: 3,
  datapointsToAlarm: 2,
  comparison: 'GreaterThanThreshold',
  threshold: 80,
  treatMissingData: 'missing',
  severity: 2,
  notify: true,
  notifierIds: ['ntf-a'],
  state: 'ALARM',
  stateReason: 'hot',
  stateChangedAt: 0,
  version: 1,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const aChange = (overrides: Partial<MonitorStateChange> = {}): MonitorStateChange => ({
  monitorName: 'nas-cpu',
  fromState: 'OK',
  toState: 'ALARM',
  reason: '3 of the last 3 periods breached avg > 80.',
  datapoints: [],
  threshold: 80,
  changedAt: 1_000,
  ...overrides,
});

describe('alarmMessage', () => {
  it('heads an alarm with its severity, and says why, what was watched and what it was before', () => {
    const message = alarmMessage({ monitor: aMonitor(), change: aChange(), consoleUrl: 'https://console.example/' });

    expect(message).toEqual({
      title: '[SEV-2] nas-cpu is in ALARM',
      body: '3 of the last 3 periods breached avg > 80.',
      tone: 'problem',
      severity: 2,
      link: 'https://console.example/monitors/nas-cpu',
      fields: [
        { name: 'Metric', value: 'MiniCloud/Agent CpuUtilization (avg)\nAgentId=nas' },
        { name: 'Severity', value: 'SEV-2', inline: true },
        { name: 'Was', value: 'OK', inline: true },
      ],
      timestamp: 1_000,
    });
  });

  it('marks a return to OK as resolved, and missing data as news', () => {
    expect(alarmMessage({ monitor: aMonitor(), change: aChange({ fromState: 'ALARM', toState: 'OK' }), consoleUrl: '' })).toMatchObject({
      title: 'nas-cpu is OK',
      tone: 'resolved',
    });
    expect(alarmMessage({ monitor: aMonitor(), change: aChange({ toState: 'INSUFFICIENT_DATA' }), consoleUrl: '' })).toMatchObject({
      title: 'nas-cpu has insufficient data',
      tone: 'info',
    });
  });

  it('puts the monitor’s description ahead of the reason', () => {
    expect(alarmMessage({ monitor: aMonitor({ description: 'The NAS is busy.' }), change: aChange(), consoleUrl: '' }).body).toBe(
      'The NAS is busy.\n\n3 of the last 3 periods breached avg > 80.',
    );
  });
});

describe('monitorLink', () => {
  it('links into the console, and nowhere without one', () => {
    expect(monitorLink('https://console.example//', 'a b')).toBe('https://console.example/monitors/a%20b');
    expect(monitorLink('  ', 'nas-cpu')).toBeUndefined();
  });
});

describe('testMessage', () => {
  it('says plainly that nothing is wrong', () => {
    expect(testMessage('Alerts', 5)).toMatchObject({ tone: 'info', timestamp: 5, body: expect.stringContaining('Nothing is wrong') });
  });
});

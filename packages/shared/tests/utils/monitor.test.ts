import { MonitorDefinition, TreatMissingData } from '../../src/models/monitor';
import { assertMonitorName, breaches, evaluateMonitor, parseMonitorDefinition } from '../../src/utils/monitor';

const MINUTE = 60_000;
const END = Date.UTC(2026, 8, 27, 12, 0);

const aDefinition = (overrides: Partial<MonitorDefinition> = {}): MonitorDefinition => ({
  metric: { namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'avg' },
  periodMs: 5 * MINUTE,
  evaluationPeriods: 5,
  datapointsToAlarm: 3,
  comparison: 'GreaterThanThreshold',
  threshold: 80,
  treatMissingData: 'missing',
  notify: true,
  ...overrides,
});

/**
 * The window's five periods, oldest first, as a string: a digit is a value (×10, so 9
 * is 90 and breaches 80), and '-' is a period with no datapoint. The same notation as
 * CloudWatch's documentation of missing data.
 */
function series(pattern: string, periodMs = 5 * MINUTE) {
  return [...pattern].flatMap((char, index) => (char === '-' ? [] : [{ timestamp: END - (pattern.length - index) * periodMs, value: Number(char) * 10 }]));
}

const evaluate = (pattern: string, treatMissingData: TreatMissingData = 'missing', currentState: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA' = 'OK') =>
  evaluateMonitor({ definition: aDefinition({ treatMissingData }), currentState, datapoints: series(pattern), windowEnd: END });

describe('evaluateMonitor', () => {
  it('alarms when at least M of the last N periods breach, and not when fewer do', () => {
    expect(evaluate('99900').state).toBe('ALARM');
    expect(evaluate('90909').state).toBe('ALARM');
    expect(evaluate('99000').state).toBe('OK');
  });

  it('compares strictly or inclusively as the comparison says', () => {
    expect(breaches(80, 'GreaterThanThreshold', 80)).toBe(false);
    expect(breaches(80, 'GreaterThanOrEqualToThreshold', 80)).toBe(true);
    expect(breaches(80, 'LessThanThreshold', 80)).toBe(false);
    expect(breaches(80, 'LessThanOrEqualToThreshold', 80)).toBe(true);
  });

  it('reads the N periods that end at the window’s end, and nothing before them', () => {
    // Six periods, the oldest breaching: it falls outside a five-period window.
    const datapoints = series('999000');
    const result = evaluateMonitor({ definition: aDefinition(), currentState: 'OK', datapoints, windowEnd: END });

    expect(result.datapoints.map((datapoint) => datapoint.timestamp)).toEqual([25, 20, 15, 10, 5].map((minutes) => END - minutes * MINUTE));
    expect(result.state).toBe('OK');
  });

  it('lists every period it judged, with null where the series had nothing', () => {
    expect(evaluate('9-9-9').datapoints.map((datapoint) => datapoint.value)).toEqual([90, null, 90, null, 90]);
  });

  describe('a window with no datapoint at all', () => {
    it('is INSUFFICIENT_DATA when missing data is missing', () => {
      expect(evaluate('-----', 'missing', 'ALARM').state).toBe('INSUFFICIENT_DATA');
    });

    it('keeps the state it had when missing data is ignored', () => {
      expect(evaluate('-----', 'ignore', 'ALARM').state).toBe('ALARM');
      expect(evaluate('-----', 'ignore', 'OK').state).toBe('OK');
    });

    it('alarms when missing data breaches, and is OK when it does not', () => {
      expect(evaluate('-----', 'breaching').state).toBe('ALARM');
      expect(evaluate('-----', 'notBreaching').state).toBe('OK');
    });
  });

  describe('a window with some periods missing', () => {
    it('counts a missing period as a breach only when told to', () => {
      // Two real breaches and two gaps: three needed.
      expect(evaluate('9-9-0', 'breaching').state).toBe('ALARM');
      expect(evaluate('9-9-0', 'notBreaching').state).toBe('OK');
      expect(evaluate('9-9-0', 'missing').state).toBe('OK');
      expect(evaluate('9-9-0', 'ignore').state).toBe('OK');
    });

    it('still alarms on real breaches alone, whatever missing data counts as', () => {
      for (const treatment of ['missing', 'ignore', 'breaching', 'notBreaching'] as const) {
        expect(evaluate('999--', treatment).state).toBe('ALARM');
      }
    });
  });

  it('says in its reason how many breached, against what, and how gaps were counted', () => {
    const { reason } = evaluate('99-9-', 'notBreaching');

    expect(reason).toBe(
      '3 of the last 5 periods of 5 minutes breached avg > 80, at least the 3 that raise the alarm (the latest was 90; 2 had no datapoint and counted as not breaching).',
    );
  });
});

describe('parseMonitorDefinition', () => {
  const aBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ ...aDefinition(), ...overrides });

  it('accepts a definition and returns the same definition', () => {
    const body = aBody({ description: 'CPU on the NAS' });

    expect(parseMonitorDefinition(body, 'monitor')).toEqual(body);
  });

  it('refuses more datapoints to alarm than periods evaluated', () => {
    expect(() => parseMonitorDefinition(aBody({ evaluationPeriods: 3, datapointsToAlarm: 4 }), 'monitor')).toThrow(/datapointsToAlarm must be from 1 to evaluationPeriods \(3\)/);
  });

  it('refuses a window longer than a day, which one evaluation cannot read', () => {
    expect(() => parseMonitorDefinition(aBody({ periodMs: 3_600_000, evaluationPeriods: 25, datapointsToAlarm: 1 }), 'monitor')).toThrow(
      /25 periods of 1 hour, longer than the day/,
    );
  });

  it('refuses a period that is not a whole number of minutes', () => {
    expect(() => parseMonitorDefinition(aBody({ periodMs: 90_000 }), 'monitor')).toThrow(/whole number of minutes/);
  });

  it('refuses an unknown comparison, missing-data treatment or field', () => {
    expect(() => parseMonitorDefinition(aBody({ comparison: '>' }), 'monitor')).toThrow(/monitor.comparison must be one of/);
    expect(() => parseMonitorDefinition(aBody({ treatMissingData: 'zero' }), 'monitor')).toThrow(/monitor.treatMissingData must be one of/);
    expect(() => parseMonitorDefinition(aBody({ enabled: true }), 'monitor')).toThrow(/monitor.enabled is not a field/);
  });

  it('refuses a statistic the service cannot compute', () => {
    expect(() => parseMonitorDefinition(aBody({ metric: { ...aDefinition().metric, statistic: 'median' } }), 'monitor')).toThrow(/monitor.metric.statistic/);
  });
});

describe('assertMonitorName', () => {
  it('accepts a name a link can carry as it is, and refuses one it cannot', () => {
    expect(assertMonitorName('nas-cpu_high', 'name')).toBe('nas-cpu_high');
    expect(() => assertMonitorName('nas cpu', 'name')).toThrow(/letters, digits, hyphens and underscores/);
  });
});

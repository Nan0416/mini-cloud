import { PgMonitorDao } from '../../src/data/pg-monitor-dao';
import { fakePool } from './test-helpers';

const aRow = (overrides: Record<string, unknown> = {}) => ({
  name: 'nas-cpu',
  description: null,
  namespace: 'MiniCloud/Agent',
  metric_name: 'CpuUtilization',
  dimensions: { AgentId: 'nas' },
  statistic: 'p99',
  period_ms: '300000',
  evaluation_periods: 5,
  datapoints_to_alarm: 3,
  comparison: 'GreaterThanThreshold',
  threshold: 80,
  treat_missing_data: 'breaching',
  severity: 3,
  notify: true,
  notifier_ids: [],
  state: 'ALARM',
  state_reason: 'hot',
  state_changed_at: new Date(Date.UTC(2026, 8, 1)),
  last_evaluated_at: null,
  version: 2,
  created_at: new Date(Date.UTC(2026, 8, 1)),
  updated_at: new Date(Date.UTC(2026, 8, 2)),
  ...overrides,
});

const aDefinition = {
  metric: { namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'avg' as const },
  periodMs: 300_000,
  evaluationPeriods: 5,
  datapointsToAlarm: 3,
  comparison: 'GreaterThanThreshold' as const,
  threshold: 80,
  treatMissingData: 'missing' as const,
  severity: 3 as const,
  notify: true,
  notifierIds: [],
};

describe('PgMonitorDao', () => {
  it('maps a row into a monitor, with the period read back as a number and absent fields left out', async () => {
    const pool = fakePool().on('WHERE m.name = $1', { rows: [aRow({ notifier_ids: ['ntf-a', 'ntf-b'] })] });

    const { monitor } = await new PgMonitorDao(pool.asPool()).getMonitor({ name: 'nas-cpu' });

    expect(monitor).toMatchObject({
      name: 'nas-cpu',
      metric: { namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'p99' },
      periodMs: 300_000,
      state: 'ALARM',
      severity: 3,
      notifierIds: ['ntf-a', 'ntf-b'],
      version: 2,
    });
    expect(monitor?.description).toBeUndefined();
    expect(monitor?.lastEvaluatedAt).toBeUndefined();
  });

  it('refuses a row whose state the schema and the types disagree on, as an internal error', async () => {
    const pool = fakePool().on('WHERE m.name = $1', { rows: [aRow({ state: 'PENDING' })] });

    await expect(new PgMonitorDao(pool.asPool()).getMonitor({ name: 'nas-cpu' })).rejects.toThrow(/unrecognised state "PENDING"/);
  });

  it('binds the dimensions as JSON text, which is what a JSONB column takes', async () => {
    const pool = fakePool().on('INSERT INTO monitor', { rows: [aRow()] });

    await new PgMonitorDao(pool.asPool()).createMonitor({ name: 'nas-cpu', ...aDefinition, stateReason: 'new' });

    expect(pool.find('INSERT INTO monitor').values).toEqual([
      'nas-cpu',
      null,
      'MiniCloud/Agent',
      'CpuUtilization',
      '{"AgentId":"nas"}',
      'avg',
      300_000,
      5,
      3,
      'GreaterThanThreshold',
      80,
      'missing',
      3,
      true,
      'new',
    ]);
  });

  it('links its notifiers in the transaction that creates it', async () => {
    const pool = fakePool().on('INSERT INTO monitor ', { rows: [aRow()] });

    const { monitor } = await new PgMonitorDao(pool.asPool()).createMonitor({ name: 'nas-cpu', ...aDefinition, notifierIds: ['ntf-b', 'ntf-a'], stateReason: 'new' });

    const inTransaction = pool.queries.filter((query) => query.onClient).map((query) => query.sql.replace(/\s+/g, ' ').trim());
    expect(inTransaction[0]).toBe('BEGIN');
    expect(inTransaction[2]).toContain('INSERT INTO monitor_notifier');
    expect(pool.find('INSERT INTO monitor_notifier').values).toEqual(['nas-cpu', ['ntf-b', 'ntf-a']]);
    expect(inTransaction[3]).toBe('COMMIT');
    expect(monitor?.notifierIds).toEqual(['ntf-a', 'ntf-b']);
  });

  it('links nothing when the name is taken', async () => {
    const pool = fakePool();

    const { monitor } = await new PgMonitorDao(pool.asPool()).createMonitor({ name: 'nas-cpu', ...aDefinition, notifierIds: ['ntf-a'], stateReason: 'new' });

    expect(monitor).toBeUndefined();
    expect(pool.statements.some((sql) => sql.includes('monitor_notifier'))).toBe(false);
  });

  it('replaces its notifiers on an edit, and rolls the edit back, reporting it, when a notifier has gone', async () => {
    const pool = fakePool()
      .on('UPDATE monitor', { rows: [aRow()] })
      .failOn('INSERT INTO monitor_notifier', Object.assign(new Error('violates foreign key constraint'), { code: '23503', constraint: 'monitor_notifier_notifier_id_fkey' }));

    const result = await new PgMonitorDao(pool.asPool()).updateMonitor({ name: 'nas-cpu', version: 2, ...aDefinition, notifierIds: ['ntf-gone'] });

    expect(result).toEqual({ notifierMissing: true });

    const inTransaction = pool.queries.filter((query) => query.onClient).map((query) => query.sql.replace(/\s+/g, ' ').trim());
    expect(inTransaction[2]).toBe('DELETE FROM monitor_notifier WHERE monitor_name = $1');
    expect(inTransaction.at(-1)).toBe('ROLLBACK');
    expect(pool.releases).toBe(1);
  });

  it('passes on any other failure to link notifiers', async () => {
    const pool = fakePool()
      .on('INSERT INTO monitor ', { rows: [aRow()] })
      .failOn('INSERT INTO monitor_notifier', new Error('connection reset'));

    await expect(new PgMonitorDao(pool.asPool()).createMonitor({ name: 'nas-cpu', ...aDefinition, notifierIds: ['ntf-a'], stateReason: 'new' })).rejects.toThrow(
      'connection reset',
    );
  });

  it('guards an update on the version it was made from, in the same statement', async () => {
    const pool = fakePool();

    const { monitor } = await new PgMonitorDao(pool.asPool()).updateMonitor({ name: 'nas-cpu', version: 3, ...aDefinition });

    expect(monitor).toBeUndefined();
    expect(pool.statements.find((sql) => sql.startsWith('UPDATE monitor'))).toContain('WHERE name = $1 AND version = $2');
    expect(pool.statements.some((sql) => sql.includes('monitor_notifier'))).toBe(false);
  });

  it('records a change of state only when the monitor is still in the state and at the version it was judged against, atomically', async () => {
    const pool = fakePool().on('UPDATE monitor SET state', { rows: [], rowCount: 0 });

    const { change } = await new PgMonitorDao(pool.asPool()).changeState({
      name: 'nas-cpu',
      fromState: 'OK',
      version: 2,
      toState: 'ALARM',
      reason: 'hot',
      datapoints: [],
      threshold: 80,
      changedAt: 0,
    });

    const inTransaction = pool.queries.filter((query) => query.onClient).map((query) => query.sql.replace(/\s+/g, ' ').trim());
    expect(change).toBeUndefined();
    expect(inTransaction[0]).toBe('BEGIN');
    expect(inTransaction[1]).toContain('WHERE name = $1 AND state = $2 AND version = $6');
    expect(pool.find('UPDATE monitor SET state').values[5]).toBe(2);
    expect(inTransaction[2]).toBe('ROLLBACK');
    expect(pool.statements.some((sql) => sql.includes('INSERT INTO monitor_state_change'))).toBe(false);
    expect(pool.releases).toBe(1);
  });
});

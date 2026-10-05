import { Pool } from 'pg';
import path from 'node:path';
import { migrate } from '../../src/data/migrate';
import { PgAgentDao } from '../../src/data/pg-agent-dao';
import { PgDashboardDao } from '../../src/data/pg-dashboard-dao';
import { PgMonitorDao } from '../../src/data/pg-monitor-dao';
import { PgNotifierDao } from '../../src/data/pg-notifier-dao';
import { PgTaskDao } from '../../src/data/pg-task-dao';
import { PgTaskDynamicsDao } from '../../src/data/pg-task-dynamics-dao';
import { PgTaskInstanceDao } from '../../src/data/pg-task-instance-dao';
import { PgVariableDao } from '../../src/data/pg-variable-dao';
import { createPool } from '../../src/data/pool';

/**
 * Exercises the SQL against a real PostgreSQL.
 *
 * These earn their keep because the interesting behaviour lives in the queries —
 * rank-guarded updates, joins across three tables, array columns — none of which a
 * mocked pool would verify. A missing column in a SELECT type-checks fine and only
 * fails at runtime.
 *
 * Skipped unless MINI_CLOUD_TEST_DATABASE_URL points at a throwaway database:
 *
 *   docker run -d --name mini-cloud-test-pg -e POSTGRES_USER=minicloud \
 *     -e POSTGRES_PASSWORD=minicloud -e POSTGRES_DB=mini_cloud_test \
 *     -p 55432:5432 postgres:17-alpine
 *   MINI_CLOUD_TEST_DATABASE_URL=postgres://minicloud:minicloud@127.0.0.1:55432/mini_cloud_test npm test
 */
const DATABASE_URL = process.env['MINI_CLOUD_TEST_DATABASE_URL'];
const describeIfDatabase = DATABASE_URL === undefined ? describe.skip : describe;

describeIfDatabase('PostgreSQL DAOs', () => {
  let pool: Pool;
  let taskDao: PgTaskDao;
  let dynamicsDao: PgTaskDynamicsDao;
  let instanceDao: PgTaskInstanceDao;
  let agentDao: PgAgentDao;
  let variableDao: PgVariableDao;
  let dashboardDao: PgDashboardDao;
  let monitorDao: PgMonitorDao;
  let notifierDao: PgNotifierDao;

  beforeAll(async () => {
    pool = createPool({ connectionString: DATABASE_URL ?? '' });
    await migrate(pool, path.resolve(__dirname, '..', '..', 'migrations'));
    taskDao = new PgTaskDao(pool);
    dynamicsDao = new PgTaskDynamicsDao(pool);
    instanceDao = new PgTaskInstanceDao(pool);
    agentDao = new PgAgentDao(pool);
    variableDao = new PgVariableDao(pool);
    dashboardDao = new PgDashboardDao(pool);
    monitorDao = new PgMonitorDao(pool);
    notifierDao = new PgNotifierDao(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE task, task_dynamics, task_instance, task_event, agent, replacement_variable, dashboard, monitor, monitor_state_change, notifier, monitor_notifier CASCADE',
    );
  });

  const jobInput = (taskId: string, version: number, overrides: Record<string, unknown> = {}) => ({
    taskId,
    version,
    name: `job-${taskId}`,
    type: 'job' as const,
    cmd: 'echo hi',
    cwd: '/tmp',
    ...overrides,
  });

  describe('task versioning', () => {
    it('keeps every version and points the head at the newest', async () => {
      await taskDao.createTaskVersion(jobInput('t1', 1, { name: 'first' }));
      await taskDao.createTaskVersion(jobInput('t1', 2, { name: 'second' }));

      expect((await taskDao.getLatestVersionNumber({ taskId: 't1' })).version).toBe(2);
      expect((await taskDao.getLatestTask({ taskId: 't1' })).task?.name).toBe('second');
      // The old version is still resolvable, which is what lets a running instance
      // report against the definition it was launched from.
      expect((await taskDao.getTaskVersion({ taskId: 't1', version: 1 })).task?.name).toBe('first');
    });

    it('reports createdAt as when the task first existed and lastUpdatedAt as when the head was written', async () => {
      await taskDao.createTaskVersion(jobInput('t1', 1));
      await pool.query("UPDATE task SET created_at = now() - interval '2 days' WHERE task_id = 't1' AND version = 1");
      await taskDao.createTaskVersion(jobInput('t1', 2));

      const { task } = await taskDao.getLatestTask({ taskId: 't1' });
      expect(task).not.toBeNull();
      // Without the MIN(created_at) window the head's own timestamp would be
      // reported as the task's creation date, losing when it was first defined.
      expect(task!.lastUpdatedAt - task!.createdAt).toBeGreaterThan(24 * 3600_000);
    });

    it('lists only head versions', async () => {
      await taskDao.createTaskVersion(jobInput('t1', 1));
      await taskDao.createTaskVersion(jobInput('t1', 2));
      await taskDao.createTaskVersion(jobInput('t2', 1));

      const { tasks } = await taskDao.listLatestTasks({});
      expect(tasks).toHaveLength(2);
      expect(tasks.map((task) => `${task.taskId}v${task.version}`).sort()).toEqual(['t1v2', 't2v1']);
    });

    it('round-trips arguments, env and health checks through JSONB', async () => {
      await taskDao.createTaskVersion({
        taskId: 's1',
        version: 1,
        name: 'svc',
        type: 'service',
        cmd: 'run',
        cwd: '/srv',
        arguments: ['--port', '8080'],
        env: { STAGE: 'beta' },
        healthCheck: { type: 'ping', url: 'http://localhost:8080/healthz', periodInMs: 3000 },
      });

      const { task } = await taskDao.getLatestTask({ taskId: 's1' });
      expect(task?.arguments).toEqual(['--port', '8080']);
      expect(task?.env).toEqual({ STAGE: 'beta' });
      expect(task?.type === 'service' && task.healthCheck).toEqual({ type: 'ping', url: 'http://localhost:8080/healthz', periodInMs: 3000 });
    });

    it('deletes every version along with its head and dynamics', async () => {
      await taskDao.createTaskVersion(jobInput('t1', 1));
      await taskDao.createTaskVersion(jobInput('t1', 2));
      await dynamicsDao.setActive({ taskId: 't1', active: true });

      await taskDao.deleteTask({ taskId: 't1' });

      expect((await taskDao.getLatestVersionNumber({ taskId: 't1' })).version).toBeNull();
      expect((await taskDao.getTaskVersion({ taskId: 't1', version: 1 })).task).toBeNull();
      expect((await dynamicsDao.getDynamics({ taskId: 't1' })).dynamics).toBeNull();
    });
  });

  describe('listScheduledJobs', () => {
    it('returns the job together with its target agents', async () => {
      // Regression: the query once appended a JOIN to a shared SELECT list, so
      // target_agent_ids was never selected and arrived undefined.
      await taskDao.createTaskVersion(jobInput('j1', 1, { durationMs: 5000, firstLaunchAt: Date.now() }));
      await dynamicsDao.setTargetAgents({ taskId: 'j1', targetAgentIds: ['agent-a', 'agent-b'] });
      await dynamicsDao.setActive({ taskId: 'j1', active: true });

      const { scheduledJobs } = await taskDao.listScheduledJobs({});
      expect(scheduledJobs).toHaveLength(1);
      expect(scheduledJobs[0].targetAgentIds).toEqual(['agent-a', 'agent-b']);
      expect(scheduledJobs[0].job.duration).toBe(5000);
      expect(scheduledJobs[0].job.firstLaunchAt).toBeGreaterThan(0);
    });

    it('judges schedulability against the head version, not any version', async () => {
      // v1 is a schedulable job; v2 removes the schedule. Deriving "latest" with
      // DISTINCT ON has to happen before the filters, or v1 would stand in for a
      // head version that is no longer supposed to run.
      await taskDao.createTaskVersion(jobInput('j1', 1, { durationMs: 5000, firstLaunchAt: Date.now() }));
      await taskDao.createTaskVersion(jobInput('j1', 2));
      await dynamicsDao.setTargetAgents({ taskId: 'j1', targetAgentIds: ['agent-a'] });
      await dynamicsDao.setActive({ taskId: 'j1', active: true });

      expect((await taskDao.listScheduledJobs({})).scheduledJobs).toHaveLength(0);
    });

    it('reports the head version of a job that is still scheduled', async () => {
      await taskDao.createTaskVersion(jobInput('j1', 1, { durationMs: 5000, firstLaunchAt: Date.now() }));
      await taskDao.createTaskVersion(jobInput('j1', 2, { durationMs: 60_000, firstLaunchAt: Date.now(), name: 'v2' }));
      await dynamicsDao.setTargetAgents({ taskId: 'j1', targetAgentIds: ['agent-a'] });
      await dynamicsDao.setActive({ taskId: 'j1', active: true });

      const { scheduledJobs } = await taskDao.listScheduledJobs({});
      expect(scheduledJobs).toHaveLength(1);
      expect(scheduledJobs[0].job.version).toBe(2);
      expect(scheduledJobs[0].job.duration).toBe(60_000);
    });

    it('excludes jobs that are inactive, unanchored, untargeted, or services', async () => {
      const anchored = { durationMs: 5000, firstLaunchAt: Date.now() };

      await taskDao.createTaskVersion(jobInput('inactive', 1, anchored));
      await dynamicsDao.setTargetAgents({ taskId: 'inactive', targetAgentIds: ['agent-a'] });

      await taskDao.createTaskVersion(jobInput('unanchored', 1));
      await dynamicsDao.setTargetAgents({ taskId: 'unanchored', targetAgentIds: ['agent-a'] });
      await dynamicsDao.setActive({ taskId: 'unanchored', active: true });

      await taskDao.createTaskVersion(jobInput('untargeted', 1, anchored));
      await dynamicsDao.setActive({ taskId: 'untargeted', active: true });

      await taskDao.createTaskVersion({ taskId: 'svc', version: 1, name: 'svc', type: 'service', cmd: 'run', cwd: '/srv' });
      await dynamicsDao.setTargetAgents({ taskId: 'svc', targetAgentIds: ['agent-a'] });
      await dynamicsDao.setActive({ taskId: 'svc', active: true });

      expect((await taskDao.listScheduledJobs({})).scheduledJobs).toHaveLength(0);
    });
  });

  describe('instance status guard', () => {
    beforeEach(async () => {
      await taskDao.createTaskVersion(jobInput('t1', 1));
      await instanceDao.createInstance({ instanceId: 'i1', taskId: 't1', taskVersion: 1, agentId: 'agent-a', status: 'init' });
    });

    it('applies a status that moves the instance forward', async () => {
      const result = await instanceDao.updateStatus({ instanceId: 'i1', status: 'running' });
      expect(result).toMatchObject({ found: true, applied: true, currentStatus: 'running' });
    });

    it('rejects a stale status without changing the stored one', async () => {
      await instanceDao.updateStatus({ instanceId: 'i1', status: 'terminated' });
      const result = await instanceDao.updateStatus({ instanceId: 'i1', status: 'terminating' });

      expect(result).toMatchObject({ found: true, applied: false, currentStatus: 'terminated' });
      expect((await instanceDao.getInstance({ instanceId: 'i1' })).instance?.status).toBe('terminated');
    });

    it('allows movement between equally ranked statuses so health can recover', async () => {
      await instanceDao.updateStatus({ instanceId: 'i1', status: 'running' });
      expect((await instanceDao.updateStatus({ instanceId: 'i1', status: 'health_check_failure' })).applied).toBe(true);
      expect((await instanceDao.updateStatus({ instanceId: 'i1', status: 'running' })).applied).toBe(true);
      expect((await instanceDao.getInstance({ instanceId: 'i1' })).instance?.status).toBe('running');
    });

    it('reports a missing instance rather than silently succeeding', async () => {
      expect(await instanceDao.updateStatus({ instanceId: 'nope', status: 'running' })).toMatchObject({ found: false, applied: false });
    });

    it('survives concurrent reports arriving out of order', async () => {
      // The guard lives in the UPDATE's WHERE clause, so firing these together must
      // still settle on the furthest-along status.
      await Promise.all([
        instanceDao.updateStatus({ instanceId: 'i1', status: 'terminated' }),
        instanceDao.updateStatus({ instanceId: 'i1', status: 'terminating' }),
        instanceDao.updateStatus({ instanceId: 'i1', status: 'running' }),
        instanceDao.updateStatus({ instanceId: 'i1', status: 'launched' }),
      ]);
      expect((await instanceDao.getInstance({ instanceId: 'i1' })).instance?.status).toBe('terminated');
    });
  });

  describe('agents', () => {
    it('registers on first heartbeat and stays registered afterwards', async () => {
      const { agent: first } = await agentDao.recordHeartbeat({ agentId: 'a1', name: 'laptop' });
      expect(first).toMatchObject({ agentId: 'a1', name: 'laptop', status: 'online' });

      await agentDao.setStatus({ agentId: 'a1', status: 'offline' });
      const { agent: second } = await agentDao.recordHeartbeat({ agentId: 'a1', name: 'laptop-renamed' });
      expect(second).toMatchObject({ status: 'online', name: 'laptop-renamed' });
      expect(second.registeredAt).toBe(first.registeredAt);
    });

    it('expires only agents that have gone quiet', async () => {
      await agentDao.recordHeartbeat({ agentId: 'fresh', name: 'fresh' });
      await agentDao.recordHeartbeat({ agentId: 'stale', name: 'stale' });
      await pool.query("UPDATE agent SET last_seen_at = now() - interval '1 hour' WHERE agent_id = 'stale'");

      const { agents: expired } = await agentDao.expireAgents({ before: Date.now() - 15_000 });
      expect(expired.map((agent) => agent.agentId)).toEqual(['stale']);
      expect((await agentDao.getAgent({ agentId: 'fresh' })).agent?.status).toBe('online');
    });
  });

  describe('replacement variables', () => {
    it('replaces the whole set so omitted names are deleted', async () => {
      await variableDao.replaceVariables({ variables: { A: '1', B: '2' } });
      const { variables: stored } = await variableDao.replaceVariables({ variables: { B: 'two', C: '3' } });

      expect(stored).toEqual({ B: 'two', C: '3' });
    });

    it('clears everything when given an empty set', async () => {
      await variableDao.replaceVariables({ variables: { A: '1' } });
      expect((await variableDao.replaceVariables({ variables: {} })).variables).toEqual({});
    });
  });

  describe('dashboards', () => {
    const widgets = [
      { id: 'w1', title: 'CPU', queries: [{ id: 'm1', namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'p99' as const }] },
    ];

    it('stores widgets and defaults and reads them back unchanged', async () => {
      await dashboardDao.createDashboard({ name: 'home', widgets, defaultRange: { kind: 'relative', durationMs: 3_600_000 }, defaultPeriodMs: 300_000 });

      const { dashboard } = await dashboardDao.getDashboard({ name: 'home' });

      expect(dashboard).toMatchObject({ name: 'home', widgets, defaultRange: { kind: 'relative', durationMs: 3_600_000 }, defaultPeriodMs: 300_000, version: 1 });
    });

    it('creates a name once', async () => {
      await dashboardDao.createDashboard({ name: 'home', widgets });

      expect((await dashboardDao.createDashboard({ name: 'home', widgets: [] })).dashboard).toBeUndefined();
      expect((await dashboardDao.getDashboard({ name: 'home' })).dashboard?.widgets).toEqual(widgets);
    });

    it('applies one of two updates made from the same version', async () => {
      await dashboardDao.createDashboard({ name: 'home', widgets: [] });

      const [first, second] = await Promise.all([
        dashboardDao.updateDashboard({ name: 'home', version: 1, widgets }),
        dashboardDao.updateDashboard({ name: 'home', version: 1, widgets: [] }),
      ]);

      expect([first.dashboard, second.dashboard].filter((dashboard) => dashboard !== undefined)).toHaveLength(1);
      expect((await dashboardDao.getDashboard({ name: 'home' })).dashboard?.version).toBe(2);
    });

    it('clears a default when an update leaves it out', async () => {
      await dashboardDao.createDashboard({ name: 'home', widgets, defaultPeriodMs: 300_000 });

      const { dashboard } = await dashboardDao.updateDashboard({ name: 'home', version: 1, widgets });

      expect(dashboard?.defaultPeriodMs).toBeUndefined();
    });
  });

  describe('monitors', () => {
    const definition = {
      description: 'CPU on the NAS',
      metric: { namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'p99' as const },
      periodMs: 300_000,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
      comparison: 'GreaterThanOrEqualToThreshold' as const,
      threshold: 95.5,
      treatMissingData: 'breaching' as const,
      severity: 2 as const,
      notify: true,
      notifierIds: [],
    };
    const change = (fromState: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA', toState: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA', changedAt: number, version = 1) => ({
      name: 'nas-cpu',
      fromState,
      version,
      toState,
      reason: `${fromState} to ${toState}`,
      datapoints: [
        { timestamp: changedAt - 300_000, value: 97.5 },
        { timestamp: changedAt, value: null },
      ],
      threshold: 95.5,
      changedAt,
    });

    it('stores a definition and reads it back unchanged, starting with insufficient data', async () => {
      await monitorDao.createMonitor({ name: 'nas-cpu', ...definition, stateReason: 'new' });

      const { monitor } = await monitorDao.getMonitor({ name: 'nas-cpu' });

      expect(monitor).toMatchObject({ name: 'nas-cpu', ...definition, state: 'INSUFFICIENT_DATA', stateReason: 'new', version: 1 });
    });

    it('refuses more datapoints to alarm than periods, in the schema as well', async () => {
      await expect(monitorDao.createMonitor({ name: 'nas-cpu', ...definition, datapointsToAlarm: 6, stateReason: 'new' })).rejects.toThrow(/check constraint/);
    });

    it('moves the state and records the change together, and reads the history newest first', async () => {
      await monitorDao.createMonitor({ name: 'nas-cpu', ...definition, stateReason: 'new' });

      await monitorDao.changeState(change('INSUFFICIENT_DATA', 'OK', Date.UTC(2026, 8, 1, 12)));
      await monitorDao.changeState(change('OK', 'ALARM', Date.UTC(2026, 8, 1, 13)));

      const { monitor } = await monitorDao.getMonitor({ name: 'nas-cpu' });
      const { changes } = await monitorDao.listStateChanges({ name: 'nas-cpu', limit: 10 });
      expect(monitor).toMatchObject({ state: 'ALARM', stateReason: 'OK to ALARM', stateChangedAt: Date.UTC(2026, 8, 1, 13), lastEvaluatedAt: Date.UTC(2026, 8, 1, 13) });
      expect(changes.map((entry) => entry.toState)).toEqual(['ALARM', 'OK']);
      expect(changes[0].datapoints).toEqual(change('OK', 'ALARM', Date.UTC(2026, 8, 1, 13)).datapoints);
    });

    it('pages the history by keyset, breaking a tie on the time by the order the changes were recorded', async () => {
      await monitorDao.createMonitor({ name: 'nas-cpu', ...definition, stateReason: 'new' });
      const tied = Date.UTC(2026, 8, 1, 12);
      await monitorDao.changeState(change('INSUFFICIENT_DATA', 'OK', tied));
      await monitorDao.changeState(change('OK', 'ALARM', tied));
      await monitorDao.changeState(change('ALARM', 'OK', tied));

      const first = await monitorDao.listStateChanges({ name: 'nas-cpu', limit: 2 });
      const second = await monitorDao.listStateChanges({ name: 'nas-cpu', limit: 2, after: first.nextCursor });

      expect(first.changes.map((entry) => entry.reason)).toEqual(['ALARM to OK', 'OK to ALARM']);
      expect(second.changes.map((entry) => entry.reason)).toEqual(['INSUFFICIENT_DATA to OK']);
      expect(second.nextCursor).toBeUndefined();
    });

    it('reads a time range of the history with the change just before it', async () => {
      await monitorDao.createMonitor({ name: 'nas-cpu', ...definition, stateReason: 'new' });
      await monitorDao.changeState(change('INSUFFICIENT_DATA', 'OK', Date.UTC(2026, 8, 1, 12)));
      await monitorDao.changeState(change('OK', 'ALARM', Date.UTC(2026, 8, 1, 13)));
      await monitorDao.changeState(change('ALARM', 'OK', Date.UTC(2026, 8, 1, 14)));
      await monitorDao.changeState(change('OK', 'ALARM', Date.UTC(2026, 8, 1, 15)));

      const { changes } = await monitorDao.listStateChanges({ name: 'nas-cpu', limit: 10, from: Date.UTC(2026, 8, 1, 13, 30), to: Date.UTC(2026, 8, 1, 15) });
      const early = await monitorDao.listStateChanges({ name: 'nas-cpu', limit: 10, from: Date.UTC(2026, 8, 1, 10), to: Date.UTC(2026, 8, 1, 11) });

      expect(changes.map((entry) => entry.reason)).toEqual(['ALARM to OK', 'OK to ALARM']);
      expect(early.changes).toEqual([]);
    });

    it('records nothing when the monitor is no longer in the state it was judged from', async () => {
      await monitorDao.createMonitor({ name: 'nas-cpu', ...definition, stateReason: 'new' });

      const { change: recorded } = await monitorDao.changeState(change('OK', 'ALARM', Date.UTC(2026, 8, 1, 12)));

      expect(recorded).toBeUndefined();
      expect((await monitorDao.listStateChanges({ name: 'nas-cpu', limit: 10 })).changes).toEqual([]);
    });

    it('records nothing judged against a definition that has since been edited', async () => {
      await monitorDao.createMonitor({ name: 'nas-cpu', ...definition, stateReason: 'new' });
      await monitorDao.updateMonitor({ name: 'nas-cpu', version: 1, ...definition, threshold: 99 });

      const { change: stale } = await monitorDao.changeState(change('INSUFFICIENT_DATA', 'ALARM', Date.UTC(2026, 8, 1, 12), 1));
      const { change: current } = await monitorDao.changeState(change('INSUFFICIENT_DATA', 'OK', Date.UTC(2026, 8, 1, 12, 1), 2));

      expect(stale).toBeUndefined();
      expect(current?.toState).toBe('OK');
      expect((await monitorDao.listStateChanges({ name: 'nas-cpu', limit: 10 })).changes.map((entry) => entry.toState)).toEqual(['OK']);
    });

    it('leaves the version alone when evaluating, so an evaluation never makes an edit conflict', async () => {
      await monitorDao.createMonitor({ name: 'nas-cpu', ...definition, stateReason: 'new' });
      await monitorDao.changeState(change('INSUFFICIENT_DATA', 'ALARM', Date.UTC(2026, 8, 1, 12)));
      await monitorDao.markEvaluated({ name: 'nas-cpu', evaluatedAt: Date.UTC(2026, 8, 1, 12, 1) });

      const { monitor } = await monitorDao.updateMonitor({ name: 'nas-cpu', version: 1, ...definition, threshold: 99 });

      expect(monitor).toMatchObject({ version: 2, threshold: 99, state: 'ALARM' });
    });

    it('takes its history with it when deleted', async () => {
      await monitorDao.createMonitor({ name: 'nas-cpu', ...definition, stateReason: 'new' });
      await monitorDao.changeState(change('INSUFFICIENT_DATA', 'ALARM', Date.UTC(2026, 8, 1, 12)));

      await monitorDao.deleteMonitor({ name: 'nas-cpu' });

      expect((await pool.query('SELECT count(*)::int AS n FROM monitor_state_change')).rows[0].n).toBe(0);
    });
  });

  describe('notifiers', () => {
    const target = { type: 'discord' as const, channel: '#alerts', webhookId: '123' };
    const credentials = { type: 'discord' as const, webhookUrl: 'https://discord.com/api/webhooks/123/token' };
    const monitor = {
      metric: { namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'avg' as const },
      periodMs: 300_000,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparison: 'GreaterThanThreshold' as const,
      threshold: 80,
      treatMissingData: 'missing' as const,
      severity: 3 as const,
      notify: true,
      stateReason: 'new',
    };

    it('stores a notifier, and hands its credentials back only for delivery', async () => {
      const { notifier } = await notifierDao.createNotifier({ notifierId: 'ntf-a', name: 'Alerts', description: 'Home', target, credentials });

      const { notifier: read } = await notifierDao.getNotifier({ notifierId: 'ntf-a' });
      const { targets } = await notifierDao.listDeliveryTargets({ notifierIds: ['ntf-a', 'ntf-gone'] });

      expect(read).toEqual(notifier);
      expect(read).toMatchObject({ name: 'Alerts', description: 'Home', target, version: 1 });
      expect(JSON.stringify(read)).not.toContain('token');
      expect(targets).toEqual([{ notifier, credentials }]);
    });

    it('refuses a second notifier of one name, on create and on rename', async () => {
      await notifierDao.createNotifier({ notifierId: 'ntf-a', name: 'Alerts', target, credentials });
      await notifierDao.createNotifier({ notifierId: 'ntf-b', name: 'Pager', target, credentials });

      const { notifier: duplicate } = await notifierDao.createNotifier({ notifierId: 'ntf-c', name: 'Alerts', target, credentials });
      const { notifier: renamed } = await notifierDao.updateNotifier({ notifierId: 'ntf-b', version: 1, name: 'Alerts', target });

      expect(duplicate).toBeUndefined();
      expect(renamed).toBeUndefined();
    });

    it('renames and keeps its webhook when an edit brings no new one, and replaces it when one does', async () => {
      await notifierDao.createNotifier({ notifierId: 'ntf-a', name: 'Alerts', target, credentials });

      const { notifier: renamed } = await notifierDao.updateNotifier({ notifierId: 'ntf-a', version: 1, name: 'Home alerts', target: { ...target, channel: '#home' } });
      const kept = await notifierDao.listDeliveryTargets({ notifierIds: ['ntf-a'] });
      await notifierDao.updateNotifier({
        notifierId: 'ntf-a',
        version: 2,
        name: 'Home alerts',
        target,
        credentials: { ...credentials, webhookUrl: 'https://discord.com/api/webhooks/123/new' },
      });
      const replaced = await notifierDao.listDeliveryTargets({ notifierIds: ['ntf-a'] });

      expect(renamed).toMatchObject({ name: 'Home alerts', target: { channel: '#home' }, version: 2 });
      expect(kept.targets[0].credentials.webhookUrl).toBe(credentials.webhookUrl);
      expect(replaced.targets[0].credentials.webhookUrl).toBe('https://discord.com/api/webhooks/123/new');
    });

    it('links a monitor to its notifiers, and replaces the links on an edit', async () => {
      await notifierDao.createNotifier({ notifierId: 'ntf-a', name: 'Alerts', target, credentials });
      await notifierDao.createNotifier({ notifierId: 'ntf-b', name: 'Pager', target, credentials });

      const { monitor: created } = await monitorDao.createMonitor({ name: 'nas-cpu', ...monitor, notifierIds: ['ntf-b', 'ntf-a'] });
      await monitorDao.updateMonitor({ name: 'nas-cpu', version: 1, ...monitor, notifierIds: ['ntf-b'] });

      expect(created?.notifierIds).toEqual(['ntf-a', 'ntf-b']);
      expect((await monitorDao.getMonitor({ name: 'nas-cpu' })).monitor?.notifierIds).toEqual(['ntf-b']);
      expect((await monitorDao.listMonitors({})).monitors.map((entry) => entry.notifierIds)).toEqual([['ntf-b']]);
    });

    it('writes no monitor at all when a notifier it names does not exist, and says so', async () => {
      const result = await monitorDao.createMonitor({ name: 'nas-cpu', ...monitor, notifierIds: ['ntf-gone'] });

      expect(result).toEqual({ notifierMissing: true });
      expect((await monitorDao.getMonitor({ name: 'nas-cpu' })).monitor).toBeUndefined();
    });

    /** Runs `work` in its own transaction and leaves it open, so a DAO call made meanwhile races it. */
    const holdOpen = async (work: (sql: (text: string) => Promise<unknown>) => Promise<void>) => {
      const client = await pool.connect();
      await client.query('BEGIN');
      await work((text) => client.query(text));
      return {
        /** Commits once the racing statement is waiting on this transaction's locks, so the race is certain to happen. */
        commit: async () => {
          for (let attempt = 0; attempt < 200; attempt++) {
            const blocked = await pool.query<{ readonly n: number }>(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
            );
            if (blocked.rows[0].n > 0) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          await client.query('COMMIT');
          client.release();
        },
      };
    };

    it('reports a monitor save that raced the delete of its notifier as a missing notifier', async () => {
      await notifierDao.createNotifier({ notifierId: 'ntf-a', name: 'Alerts', target, credentials });
      const deleting = await holdOpen((sql) => sql("DELETE FROM notifier WHERE notifier_id = 'ntf-a'").then(() => undefined));

      const saving = monitorDao.createMonitor({ name: 'nas-cpu', ...monitor, notifierIds: ['ntf-a'] });
      await deleting.commit();

      await expect(saving).resolves.toEqual({ notifierMissing: true });
    });

    it('reports a delete that raced a monitor linking the notifier as in use', async () => {
      await notifierDao.createNotifier({ notifierId: 'ntf-a', name: 'Alerts', target, credentials });
      await monitorDao.createMonitor({ name: 'nas-cpu', ...monitor, notifierIds: [] });
      const linking = await holdOpen((sql) => sql("INSERT INTO monitor_notifier (monitor_name, notifier_id) VALUES ('nas-cpu', 'ntf-a')").then(() => undefined));

      const deleting = notifierDao.deleteNotifier({ notifierId: 'ntf-a' });
      await linking.commit();

      await expect(deleting).resolves.toEqual({ deleted: false, usedBy: ['nas-cpu'] });
    });

    it('reports a rename that raced another onto the same name as nothing written', async () => {
      await notifierDao.createNotifier({ notifierId: 'ntf-a', name: 'Alerts', target, credentials });
      await notifierDao.createNotifier({ notifierId: 'ntf-b', name: 'Pager', target, credentials });
      const renaming = await holdOpen((sql) => sql("UPDATE notifier SET name = 'Home' WHERE notifier_id = 'ntf-a'").then(() => undefined));

      const racing = notifierDao.updateNotifier({ notifierId: 'ntf-b', version: 1, name: 'Home', target });
      await renaming.commit();

      await expect(racing).resolves.toEqual({});
    });

    it('refuses to delete a notifier a monitor sends to, naming the monitor, and deletes it once nothing does', async () => {
      await notifierDao.createNotifier({ notifierId: 'ntf-a', name: 'Alerts', target, credentials });
      await monitorDao.createMonitor({ name: 'nas-cpu', ...monitor, notifierIds: ['ntf-a'] });

      const refused = await notifierDao.deleteNotifier({ notifierId: 'ntf-a' });
      await monitorDao.deleteMonitor({ name: 'nas-cpu' });
      const deleted = await notifierDao.deleteNotifier({ notifierId: 'ntf-a' });
      const missing = await notifierDao.deleteNotifier({ notifierId: 'ntf-a' });

      expect(refused).toEqual({ deleted: false, usedBy: ['nas-cpu'] });
      expect(deleted).toEqual({ deleted: true, usedBy: [] });
      expect(missing).toEqual({ deleted: false, usedBy: [] });
    });

    it('makes every monitor written say its severity, the backfill default having been dropped', async () => {
      const insert = `INSERT INTO monitor (name, namespace, metric_name, dimensions, statistic, period_ms, evaluation_periods, datapoints_to_alarm, comparison, threshold, treat_missing_data, notify, state_reason)
                      VALUES ('old', 'n', 'm', '{}', 'avg', 60000, 1, 1, 'GreaterThanThreshold', 1, 'missing', true, 'r')`;

      await expect(pool.query(insert)).rejects.toThrow(/severity/);
    });
  });

  describe('health checks', () => {
    it('returns only the requested versions that actually have one', async () => {
      await taskDao.createTaskVersion({
        taskId: 's1',
        version: 1,
        name: 'svc',
        type: 'service',
        cmd: 'run',
        cwd: '/srv',
        healthCheck: { type: 'passive', periodInMs: 5000 },
      });
      await taskDao.createTaskVersion({ taskId: 's2', version: 1, name: 'no-check', type: 'service', cmd: 'run', cwd: '/srv' });

      const { healthChecks } = await taskDao.listHealthChecks({
        identifiers: [
          { taskId: 's1', version: 1 },
          { taskId: 's2', version: 1 },
          { taskId: 'missing', version: 9 },
        ],
      });

      expect(healthChecks).toEqual([{ taskId: 's1', version: 1, healthCheck: { type: 'passive', periodInMs: 5000 } }]);
    });

    it('returns nothing for an empty request without hitting the database', async () => {
      expect((await taskDao.listHealthChecks({ identifiers: [] })).healthChecks).toEqual([]);
    });
  });
});

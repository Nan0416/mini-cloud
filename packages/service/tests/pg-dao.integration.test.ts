import { Pool } from 'pg';
import path from 'path';
import { migrate } from '../src/data/migrate';
import { PgAgentDao } from '../src/data/pg-agent-dao';
import { PgTaskDao } from '../src/data/pg-task-dao';
import { PgTaskDynamicsDao } from '../src/data/pg-task-dynamics-dao';
import { PgTaskInstanceDao } from '../src/data/pg-task-instance-dao';
import { PgVariableDao } from '../src/data/pg-variable-dao';
import { createPool } from '../src/data/pool';

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

  beforeAll(async () => {
    pool = createPool({ connectionString: DATABASE_URL ?? '' });
    await migrate(pool, path.resolve(__dirname, '..', 'migrations'));
    taskDao = new PgTaskDao(pool);
    dynamicsDao = new PgTaskDynamicsDao(pool);
    instanceDao = new PgTaskInstanceDao(pool);
    agentDao = new PgAgentDao(pool);
    variableDao = new PgVariableDao(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE task, task_dynamics, task_instance, task_event, agent, replacement_variable CASCADE');
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

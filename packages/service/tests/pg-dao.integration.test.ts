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

      expect(await taskDao.getLatestVersionNumber('t1')).toBe(2);
      expect((await taskDao.getLatestTask('t1'))?.name).toBe('second');
      // The old version is still resolvable, which is what lets a running instance
      // report against the definition it was launched from.
      expect((await taskDao.getTaskVersion('t1', 1))?.name).toBe('first');
    });

    it('reports createdAt as when the task first existed and lastUpdatedAt as when the head was written', async () => {
      await taskDao.createTaskVersion(jobInput('t1', 1));
      await pool.query("UPDATE task SET created_at = now() - interval '2 days' WHERE task_id = 't1' AND version = 1");
      await taskDao.createTaskVersion(jobInput('t1', 2));

      const task = await taskDao.getLatestTask('t1');
      expect(task).not.toBeNull();
      // Without the MIN(created_at) window the head's own timestamp would be
      // reported as the task's creation date, losing when it was first defined.
      expect(task!.lastUpdatedAt - task!.createdAt).toBeGreaterThan(24 * 3600_000);
    });

    it('lists only head versions', async () => {
      await taskDao.createTaskVersion(jobInput('t1', 1));
      await taskDao.createTaskVersion(jobInput('t1', 2));
      await taskDao.createTaskVersion(jobInput('t2', 1));

      const tasks = await taskDao.listLatestTasks();
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

      const task = await taskDao.getLatestTask('s1');
      expect(task?.arguments).toEqual(['--port', '8080']);
      expect(task?.env).toEqual({ STAGE: 'beta' });
      expect(task?.type === 'service' && task.healthCheck).toEqual({ type: 'ping', url: 'http://localhost:8080/healthz', periodInMs: 3000 });
    });

    it('deletes every version along with its head and dynamics', async () => {
      await taskDao.createTaskVersion(jobInput('t1', 1));
      await taskDao.createTaskVersion(jobInput('t1', 2));
      await dynamicsDao.setActive('t1', true);

      await taskDao.deleteTask('t1');

      expect(await taskDao.getLatestVersionNumber('t1')).toBeNull();
      expect(await taskDao.getTaskVersion('t1', 1)).toBeNull();
      expect(await dynamicsDao.getDynamics('t1')).toBeNull();
    });
  });

  describe('listScheduledJobs', () => {
    it('returns the job together with its target agents', async () => {
      // Regression: the query once appended a JOIN to a shared SELECT list, so
      // target_agent_ids was never selected and arrived undefined.
      await taskDao.createTaskVersion(jobInput('j1', 1, { durationMs: 5000, firstLaunchAt: Date.now() }));
      await dynamicsDao.setTargetAgents('j1', ['agent-a', 'agent-b']);
      await dynamicsDao.setActive('j1', true);

      const scheduled = await taskDao.listScheduledJobs();
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0].targetAgentIds).toEqual(['agent-a', 'agent-b']);
      expect(scheduled[0].job.duration).toBe(5000);
      expect(scheduled[0].job.firstLaunchAt).toBeGreaterThan(0);
    });

    it('judges schedulability against the head version, not any version', async () => {
      // v1 is a schedulable job; v2 removes the schedule. Deriving "latest" with
      // DISTINCT ON has to happen before the filters, or v1 would stand in for a
      // head version that is no longer supposed to run.
      await taskDao.createTaskVersion(jobInput('j1', 1, { durationMs: 5000, firstLaunchAt: Date.now() }));
      await taskDao.createTaskVersion(jobInput('j1', 2));
      await dynamicsDao.setTargetAgents('j1', ['agent-a']);
      await dynamicsDao.setActive('j1', true);

      expect(await taskDao.listScheduledJobs()).toHaveLength(0);
    });

    it('reports the head version of a job that is still scheduled', async () => {
      await taskDao.createTaskVersion(jobInput('j1', 1, { durationMs: 5000, firstLaunchAt: Date.now() }));
      await taskDao.createTaskVersion(jobInput('j1', 2, { durationMs: 60_000, firstLaunchAt: Date.now(), name: 'v2' }));
      await dynamicsDao.setTargetAgents('j1', ['agent-a']);
      await dynamicsDao.setActive('j1', true);

      const scheduled = await taskDao.listScheduledJobs();
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0].job.version).toBe(2);
      expect(scheduled[0].job.duration).toBe(60_000);
    });

    it('excludes jobs that are inactive, unanchored, untargeted, or services', async () => {
      const anchored = { durationMs: 5000, firstLaunchAt: Date.now() };

      await taskDao.createTaskVersion(jobInput('inactive', 1, anchored));
      await dynamicsDao.setTargetAgents('inactive', ['agent-a']);

      await taskDao.createTaskVersion(jobInput('unanchored', 1));
      await dynamicsDao.setTargetAgents('unanchored', ['agent-a']);
      await dynamicsDao.setActive('unanchored', true);

      await taskDao.createTaskVersion(jobInput('untargeted', 1, anchored));
      await dynamicsDao.setActive('untargeted', true);

      await taskDao.createTaskVersion({ taskId: 'svc', version: 1, name: 'svc', type: 'service', cmd: 'run', cwd: '/srv' });
      await dynamicsDao.setTargetAgents('svc', ['agent-a']);
      await dynamicsDao.setActive('svc', true);

      expect(await taskDao.listScheduledJobs()).toHaveLength(0);
    });
  });

  describe('instance status guard', () => {
    beforeEach(async () => {
      await taskDao.createTaskVersion(jobInput('t1', 1));
      await instanceDao.createInstance({ instanceId: 'i1', taskId: 't1', taskVersion: 1, agentId: 'agent-a', status: 'init' });
    });

    it('applies a status that moves the instance forward', async () => {
      const result = await instanceDao.updateStatus('i1', 'running');
      expect(result).toMatchObject({ found: true, applied: true, currentStatus: 'running' });
    });

    it('rejects a stale status without changing the stored one', async () => {
      await instanceDao.updateStatus('i1', 'terminated');
      const result = await instanceDao.updateStatus('i1', 'terminating');

      expect(result).toMatchObject({ found: true, applied: false, currentStatus: 'terminated' });
      expect((await instanceDao.getInstance('i1'))?.status).toBe('terminated');
    });

    it('allows movement between equally ranked statuses so health can recover', async () => {
      await instanceDao.updateStatus('i1', 'running');
      expect((await instanceDao.updateStatus('i1', 'health_check_failure')).applied).toBe(true);
      expect((await instanceDao.updateStatus('i1', 'running')).applied).toBe(true);
      expect((await instanceDao.getInstance('i1'))?.status).toBe('running');
    });

    it('reports a missing instance rather than silently succeeding', async () => {
      expect(await instanceDao.updateStatus('nope', 'running')).toMatchObject({ found: false, applied: false });
    });

    it('survives concurrent reports arriving out of order', async () => {
      // The guard lives in the UPDATE's WHERE clause, so firing these together must
      // still settle on the furthest-along status.
      await Promise.all([
        instanceDao.updateStatus('i1', 'terminated'),
        instanceDao.updateStatus('i1', 'terminating'),
        instanceDao.updateStatus('i1', 'running'),
        instanceDao.updateStatus('i1', 'launched'),
      ]);
      expect((await instanceDao.getInstance('i1'))?.status).toBe('terminated');
    });
  });

  describe('agents', () => {
    it('registers on first heartbeat and stays registered afterwards', async () => {
      const first = await agentDao.recordHeartbeat('a1', 'laptop');
      expect(first).toMatchObject({ agentId: 'a1', name: 'laptop', status: 'online' });

      await agentDao.setStatus('a1', 'offline');
      const second = await agentDao.recordHeartbeat('a1', 'laptop-renamed');
      expect(second).toMatchObject({ status: 'online', name: 'laptop-renamed' });
      expect(second.registeredAt).toBe(first.registeredAt);
    });

    it('expires only agents that have gone quiet', async () => {
      await agentDao.recordHeartbeat('fresh', 'fresh');
      await agentDao.recordHeartbeat('stale', 'stale');
      await pool.query("UPDATE agent SET last_seen_at = now() - interval '1 hour' WHERE agent_id = 'stale'");

      const expired = await agentDao.expireAgents(Date.now() - 15_000);
      expect(expired.map((agent) => agent.agentId)).toEqual(['stale']);
      expect((await agentDao.getAgent('fresh'))?.status).toBe('online');
    });
  });

  describe('replacement variables', () => {
    it('replaces the whole set so omitted names are deleted', async () => {
      await variableDao.replaceVariables({ A: '1', B: '2' });
      const stored = await variableDao.replaceVariables({ B: 'two', C: '3' });

      expect(stored).toEqual({ B: 'two', C: '3' });
    });

    it('clears everything when given an empty set', async () => {
      await variableDao.replaceVariables({ A: '1' });
      expect(await variableDao.replaceVariables({})).toEqual({});
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

      const checks = await taskDao.listHealthChecks([
        { taskId: 's1', version: 1 },
        { taskId: 's2', version: 1 },
        { taskId: 'missing', version: 9 },
      ]);

      expect(checks).toEqual([{ taskId: 's1', version: 1, healthCheck: { type: 'passive', periodInMs: 5000 } }]);
    });

    it('returns nothing for an empty request without hitting the database', async () => {
      expect(await taskDao.listHealthChecks([])).toEqual([]);
    });
  });
});

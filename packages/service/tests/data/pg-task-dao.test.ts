import { InternalServiceError } from '@mini-cloud/shared';
import { PgTaskDao } from '../../src/data/pg-task-dao';
import { at, fakePool } from './test-helpers';

const TASK_CREATED_AT = Date.UTC(2026, 0, 1, 0, 0, 0);
const VERSION_CREATED_AT = Date.UTC(2026, 3, 1, 0, 0, 0);
const FIRST_LAUNCH_AT = Date.UTC(2026, 3, 2, 6, 0, 0);

const taskRow = (overrides: Record<string, unknown> = {}) => ({
  task_id: 't1',
  version: 2,
  name: 'nightly backup',
  description: null,
  type: 'job',
  cmd: 'backup.sh',
  cwd: '/srv',
  arguments: null,
  env: null,
  stdout: null,
  stderr: null,
  health_check: null,
  duration_ms: null,
  first_launch_at: null,
  created_at: at(VERSION_CREATED_AT),
  task_created_at: at(TASK_CREATED_AT),
  ...overrides,
});

const createInput = (overrides: Record<string, unknown> = {}) => ({
  taskId: 't1',
  version: 2,
  name: 'nightly backup',
  type: 'job' as const,
  cmd: 'backup.sh',
  cwd: '/srv',
  ...overrides,
});

describe('PgTaskDao.createTaskVersion', () => {
  it('writes one row, because "latest" is derived rather than stored', async () => {
    const pool = fakePool();

    await new PgTaskDao(pool.asPool()).createTaskVersion(createInput());

    // No head pointer to update means no second write, and so no transaction needed
    // to keep two tables agreeing with each other.
    expect(pool.queries).toHaveLength(1);
    expect(pool.connects).toBe(0);
  });

  it('serialises the structured columns as JSON', async () => {
    const pool = fakePool();

    await new PgTaskDao(pool.asPool()).createTaskVersion(
      createInput({
        arguments: ['--full', '--verbose'],
        env: { STAGE: 'prod' },
        type: 'service' as const,
        healthCheck: { type: 'ping' as const, url: 'http://127.0.0.1:8080/healthz' },
      }),
    );

    const values = pool.values(0);
    expect(values[7]).toBe('["--full","--verbose"]');
    expect(values[8]).toBe('{"STAGE":"prod"}');
    expect(values[11]).toBe('{"type":"ping","url":"http://127.0.0.1:8080/healthz"}');
  });

  it('writes an omitted optional as NULL, not as the string "undefined"', async () => {
    const pool = fakePool();

    await new PgTaskDao(pool.asPool()).createTaskVersion(createInput());

    // description, arguments, env, stdout, stderr, health_check, duration_ms,
    // first_launch_at — everything the caller left out.
    expect(pool.values(0)).toEqual(['t1', 2, 'nightly backup', null, 'job', 'backup.sh', '/srv', null, null, null, null, null, null, null]);
  });

  it('sends the first launch time as a Date, because the column is a timestamptz', async () => {
    const pool = fakePool();

    await new PgTaskDao(pool.asPool()).createTaskVersion(createInput({ firstLaunchAt: FIRST_LAUNCH_AT, durationMs: 86_400_000 }));

    expect(pool.values(0)[12]).toBe(86_400_000);
    expect(pool.values(0)[13]).toEqual(at(FIRST_LAUNCH_AT));
  });
});

/**
 * Every read goes through the same row-to-model mapping, so these exercise it once
 * through `getTaskVersion` rather than repeating it per method.
 */
describe('PgTaskDao row mapping', () => {
  const readOne = async (row: object) => {
    const pool = fakePool().on('FROM task t WHERE t.task_id = $1 AND t.version = $2', { rows: [row] });
    return (await new PgTaskDao(pool.asPool()).getTaskVersion({ taskId: 't1', version: 2 })).task;
  };

  it('reports createdAt as when the task first existed and lastUpdatedAt as when this version was written', async () => {
    const task = await readOne(taskRow());

    // A version is immutable, so the row's own created_at is exactly the last edit,
    // while the task's age comes from the MIN over all of its versions.
    expect(task?.createdAt).toBe(TASK_CREATED_AT);
    expect(task?.lastUpdatedAt).toBe(VERSION_CREATED_AT);
  });

  it('reads an interval back as a number, because pg hands int8 back as a string', async () => {
    const task = await readOne(taskRow({ duration_ms: '86400000', first_launch_at: at(FIRST_LAUNCH_AT) }));

    // '86400000' + 1000 is '864000001000'. A ms interval always fits a JS number, so
    // the conversion is safe and the string is not.
    expect(task).toMatchObject({ type: 'job', duration: 86_400_000, firstLaunchAt: FIRST_LAUNCH_AT });
    expect(typeof (task as { duration?: unknown }).duration).toBe('number');
  });

  it('turns every null column into an absent field', async () => {
    const task = await readOne(taskRow());

    expect(task).toMatchObject({ description: undefined, arguments: undefined, env: undefined, stdout: undefined, stderr: undefined });
  });

  it('carries the optional columns through when they are set', async () => {
    const task = await readOne(taskRow({ description: 'nightly', arguments: ['--full'], env: { STAGE: 'prod' }, stdout: '/var/log/out', stderr: '/var/log/err' }));

    expect(task).toMatchObject({
      description: 'nightly',
      arguments: ['--full'],
      env: { STAGE: 'prod' },
      stdout: '/var/log/out',
      stderr: '/var/log/err',
    });
  });

  it('discriminates a service by its type column and gives it its health check', async () => {
    const healthCheck = { type: 'passive' as const, periodInMs: 5_000 };
    const task = await readOne(taskRow({ type: 'service', health_check: healthCheck, duration_ms: '999' }));

    expect(task).toMatchObject({ type: 'service', healthCheck });
    // A service has no schedule, so the job-only columns must not leak onto it even
    // when the row still carries values in them.
    expect(task).not.toHaveProperty('duration');
    expect(task).not.toHaveProperty('firstLaunchAt');
  });

  it('refuses a type the union does not contain rather than returning a half-built task', async () => {
    await expect(readOne(taskRow({ type: 'cronjob' }))).rejects.toThrow(InternalServiceError);
    await expect(readOne(taskRow({ type: 'cronjob' }))).rejects.toThrow(/t1 version 2.*cronjob/);
  });
});

describe('PgTaskDao.getTaskVersion', () => {
  it('returns null for a version that was never written', async () => {
    const pool = fakePool();

    expect((await new PgTaskDao(pool.asPool()).getTaskVersion({ taskId: 't1', version: 9 })).task).toBeNull();
    expect(pool.values(0)).toEqual(['t1', 9]);
  });
});

describe('PgTaskDao.getLatestTask', () => {
  it('asks the database for the highest version rather than sorting in memory', async () => {
    const pool = fakePool().on('ORDER BY t.version DESC LIMIT 1', { rows: [taskRow({ version: 7 })] });

    const { task } = await new PgTaskDao(pool.asPool()).getLatestTask({ taskId: 't1' });

    expect(task?.version).toBe(7);
    expect(pool.values(0)).toEqual(['t1']);
  });

  it('returns null for a task with no versions', async () => {
    expect((await new PgTaskDao(fakePool().asPool()).getLatestTask({ taskId: 'gone' })).task).toBeNull();
  });
});

describe('PgTaskDao.getLatestVersionNumber', () => {
  it('returns the highest version', async () => {
    const pool = fakePool().on('SELECT MAX(version)', { rows: [{ version: 4 }] });

    expect((await new PgTaskDao(pool.asPool()).getLatestVersionNumber({ taskId: 't1' })).version).toBe(4);
  });

  it('returns null for a task that does not exist', async () => {
    // MAX over no rows yields one row holding NULL, not zero rows — so the row is
    // present and it is the value that has to be checked.
    const pool = fakePool().on('SELECT MAX(version)', { rows: [{ version: null }] });

    expect((await new PgTaskDao(pool.asPool()).getLatestVersionNumber({ taskId: 'gone' })).version).toBeNull();
  });

  it('returns null rather than crashing if no row comes back at all', async () => {
    const pool = fakePool().on('SELECT MAX(version)', { rows: [] });

    expect((await new PgTaskDao(pool.asPool()).getLatestVersionNumber({ taskId: 'gone' })).version).toBeNull();
  });
});

describe('PgTaskDao.listLatestTasks', () => {
  it('keeps one row per task, the newest version of each', async () => {
    const pool = fakePool().on('SELECT DISTINCT ON', { rows: [taskRow({ task_id: 'a', version: 3 }), taskRow({ task_id: 'b', version: 1 })] });

    const { tasks } = await new PgTaskDao(pool.asPool()).listLatestTasks({});

    expect(tasks.map((task) => [task.taskId, task.version])).toEqual([
      ['a', 3],
      ['b', 1],
    ]);
    expect(pool.sql(0)).toContain('DISTINCT ON (t.task_id)');
  });

  it('presents the newest task first, whatever order DISTINCT ON forced on the SQL', async () => {
    const older = taskRow({ task_id: 'old', task_created_at: at(TASK_CREATED_AT) });
    const newer = taskRow({ task_id: 'new', task_created_at: at(TASK_CREATED_AT + 60_000) });
    // DISTINCT ON dictates ORDER BY t.task_id, so the SQL cannot also sort by age.
    const pool = fakePool().on('SELECT DISTINCT ON', { rows: [older, newer] });

    const { tasks } = await new PgTaskDao(pool.asPool()).listLatestTasks({});

    expect(tasks.map((task) => task.taskId)).toEqual(['new', 'old']);
  });

  it('returns an empty list when there are no tasks', async () => {
    expect((await new PgTaskDao(fakePool().asPool()).listLatestTasks({})).tasks).toEqual([]);
  });
});

describe('PgTaskDao.deleteTask', () => {
  it('removes the dynamics and every version in one transaction', async () => {
    const pool = fakePool();

    await new PgTaskDao(pool.asPool()).deleteTask({ taskId: 't1' });

    expect(pool.statements).toEqual(['BEGIN', 'DELETE FROM task_dynamics WHERE task_id = $1', 'DELETE FROM task WHERE task_id = $1', 'COMMIT']);
    // Dynamics first: the row references the task, so deleting the task first would
    // hit the foreign key.
    expect(pool.queries.every((query) => query.onClient)).toBe(true);
    expect(pool.releases).toBe(1);
  });

  it('rolls back and rethrows when a statement fails', async () => {
    const pool = fakePool().failOn('DELETE FROM task WHERE', new Error('deadlock detected'));

    await expect(new PgTaskDao(pool.asPool()).deleteTask({ taskId: 't1' })).rejects.toThrow('deadlock detected');

    expect(pool.statements).toEqual(['BEGIN', 'DELETE FROM task_dynamics WHERE task_id = $1', 'DELETE FROM task WHERE task_id = $1', 'ROLLBACK']);
  });

  it('returns the client to the pool even when the transaction failed', async () => {
    const pool = fakePool().failOn('DELETE FROM task WHERE', new Error('deadlock detected'));

    await expect(new PgTaskDao(pool.asPool()).deleteTask({ taskId: 't1' })).rejects.toThrow();

    // A leaked client on the error path exhausts the pool after `max` failures and
    // then every later query hangs waiting for one.
    expect(pool.releases).toBe(1);
  });
});

describe('PgTaskDao.listHealthChecks', () => {
  it('issues no query at all for an empty set', async () => {
    const pool = fakePool();

    expect((await new PgTaskDao(pool.asPool()).listHealthChecks({ identifiers: [] })).healthChecks).toEqual([]);
    // `unnest` over two empty arrays is a valid but pointless round trip.
    expect(pool.queries).toHaveLength(0);
  });

  it('fetches the whole set in one round trip, as two parallel arrays', async () => {
    const pool = fakePool().on('JOIN unnest', { rows: [] });

    await new PgTaskDao(pool.asPool()).listHealthChecks({
      identifiers: [
        { taskId: 'a', version: 1 },
        { taskId: 'b', version: 2 },
      ],
    });

    // The two arrays are zipped back into pairs by unnest, so their order has to
    // match — ids and versions are built from the same list in the same pass.
    expect(pool.values(0)).toEqual([
      ['a', 'b'],
      [1, 2],
    ]);
    expect(pool.queries).toHaveLength(1);
  });

  it('maps rows back onto identifier-plus-check pairs', async () => {
    const healthCheck = { type: 'ping' as const, url: 'http://127.0.0.1:8080/healthz' };
    const pool = fakePool().on('JOIN unnest', { rows: [{ task_id: 'a', version: 1, health_check: healthCheck }] });

    const { healthChecks } = await new PgTaskDao(pool.asPool()).listHealthChecks({ identifiers: [{ taskId: 'a', version: 1 }] });

    expect(healthChecks).toEqual([{ taskId: 'a', version: 1, healthCheck }]);
    // Versions without a check are dropped by the query, not filtered afterwards.
    expect(pool.sql(0)).toContain('WHERE t.health_check IS NOT NULL');
  });
});

describe('PgTaskDao.listScheduledJobs', () => {
  it('pairs each schedulable job with the agents it targets', async () => {
    const pool = fakePool().on('JOIN task_dynamics d', {
      rows: [taskRow({ duration_ms: '5000', first_launch_at: at(FIRST_LAUNCH_AT), target_agent_ids: ['mac-mini', 'nuc'] })],
    });

    const { scheduledJobs } = await new PgTaskDao(pool.asPool()).listScheduledJobs({});

    expect(scheduledJobs).toHaveLength(1);
    expect(scheduledJobs[0]?.targetAgentIds).toEqual(['mac-mini', 'nuc']);
    expect(scheduledJobs[0]?.job).toMatchObject({ taskId: 't1', type: 'job', duration: 5_000, firstLaunchAt: FIRST_LAUNCH_AT });
  });

  it('judges schedulability against the head version, inside the subquery', async () => {
    const pool = fakePool().on('JOIN task_dynamics d', { rows: [] });

    await new PgTaskDao(pool.asPool()).listScheduledJobs({});

    // Filtering after DISTINCT ON would let an older version that happens to be
    // schedulable stand in for a head version that is not.
    const sql = pool.sql(0);
    expect(sql).toContain("WHERE head.type = 'job'");
    expect(sql).toContain('d.active = TRUE');
    expect(sql).toContain('head.first_launch_at IS NOT NULL');
    expect(sql).toContain('cardinality(d.target_agent_ids) > 0');
  });

  it('reads the whole schedule in one query rather than one per task', async () => {
    const pool = fakePool().on('JOIN task_dynamics d', {
      rows: [taskRow({ task_id: 'a', target_agent_ids: ['x'] }), taskRow({ task_id: 'b', target_agent_ids: ['y'] })],
    });

    const { scheduledJobs } = await new PgTaskDao(pool.asPool()).listScheduledJobs({});

    // The scheduler runs this every tick, so an N+1 here is an N+1 forever.
    expect(pool.queries).toHaveLength(1);
    expect(scheduledJobs.map((scheduled) => scheduled.job.taskId)).toEqual(['a', 'b']);
  });

  it('skips a row the type discriminator says is not a job', async () => {
    const pool = fakePool().on('JOIN task_dynamics d', {
      rows: [taskRow({ task_id: 'a', type: 'service', target_agent_ids: ['x'] }), taskRow({ task_id: 'b', target_agent_ids: ['y'] })],
    });

    // Unreachable given the WHERE clause, but the narrowing has to hold regardless —
    // and it must skip the row rather than abandon the rest of the tick.
    const { scheduledJobs } = await new PgTaskDao(pool.asPool()).listScheduledJobs({});

    expect(scheduledJobs.map((scheduled) => scheduled.job.taskId)).toEqual(['b']);
  });
});

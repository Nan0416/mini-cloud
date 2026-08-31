import { InternalServiceError, TASK_INSTANCE_STATUS_RANK } from '@mini-cloud/shared';
import { PgTaskInstanceDao } from '../../src/data/pg-task-instance-dao';
import { at, fakePool } from './test-helpers';

const CREATED_AT = Date.UTC(2026, 2, 1, 8, 0, 0);
const UPDATED_AT = Date.UTC(2026, 2, 1, 9, 30, 0);

const instanceRow = (overrides: Record<string, unknown> = {}) => ({
  instance_id: 'i1',
  task_id: 't1',
  task_version: 3,
  agent_id: 'mac-mini',
  pid: 4211,
  status: 'running',
  created_at: at(CREATED_AT),
  updated_at: at(UPDATED_AT),
  ...overrides,
});

describe('PgTaskInstanceDao.createInstance', () => {
  it('writes the rank alongside the status, so the guard has something to compare', async () => {
    const pool = fakePool();

    await new PgTaskInstanceDao(pool.asPool()).createInstance({ instanceId: 'i1', taskId: 't1', taskVersion: 3, agentId: 'mac-mini', status: 'init' });

    // The rank is derived here rather than stored by the caller: two columns that
    // must agree should only ever be written together.
    expect(pool.values(0)).toEqual(['i1', 't1', 3, 'mac-mini', 'init', TASK_INSTANCE_STATUS_RANK.init]);
  });

  it('derives the rank from whichever status it is given', async () => {
    const pool = fakePool();

    await new PgTaskInstanceDao(pool.asPool()).createInstance({ instanceId: 'i1', taskId: 't1', taskVersion: 1, agentId: 'a', status: 'initiation_failed' });

    expect(pool.values(0)[5]).toBe(TASK_INSTANCE_STATUS_RANK.initiation_failed);
  });
});

describe('PgTaskInstanceDao.getInstance', () => {
  it('maps the row onto the shared model', async () => {
    const pool = fakePool().on('SELECT', { rows: [instanceRow()] });

    const { instance } = await new PgTaskInstanceDao(pool.asPool()).getInstance({ instanceId: 'i1' });

    expect(instance).toEqual({
      instanceId: 'i1',
      taskId: 't1',
      taskVersion: 3,
      agentId: 'mac-mini',
      pid: 4211,
      status: 'running',
      createdAt: CREATED_AT,
      lastUpdatedAt: UPDATED_AT,
    });
  });

  it('reports an instance whose process has not reported itself as having no pid', async () => {
    const pool = fakePool().on('SELECT', { rows: [instanceRow({ pid: null, status: 'launched' })] });

    const { instance } = await new PgTaskInstanceDao(pool.asPool()).getInstance({ instanceId: 'i1' });

    expect(instance?.pid).toBeUndefined();
  });

  it('returns null for an unknown instance', async () => {
    const pool = fakePool();

    expect((await new PgTaskInstanceDao(pool.asPool()).getInstance({ instanceId: 'gone' })).instance).toBeNull();
  });

  it('refuses a status the lifecycle does not define', async () => {
    const pool = fakePool().on('SELECT', { rows: [instanceRow({ status: 'zombie' })] });

    await expect(new PgTaskInstanceDao(pool.asPool()).getInstance({ instanceId: 'i1' })).rejects.toThrow(InternalServiceError);
  });
});

/**
 * The WHERE clause is assembled from whichever filters the caller supplied, so the
 * placeholder numbers and the values array are built in lockstep at runtime. Getting
 * that pairing wrong is silent — the query still runs, against the wrong column.
 */
describe('PgTaskInstanceDao.listInstances', () => {
  it('omits the WHERE clause entirely when nothing is filtered', async () => {
    const pool = fakePool();

    await new PgTaskInstanceDao(pool.asPool()).listInstances({});

    expect(pool.sql(0)).not.toContain('WHERE');
    // The limit still occupies $1, because it is pushed after the (empty) filter set.
    expect(pool.sql(0)).toContain('LIMIT $1');
    expect(pool.values(0)).toEqual([200]);
  });

  it('defaults to 200 rather than reading the whole table', async () => {
    const pool = fakePool();

    await new PgTaskInstanceDao(pool.asPool()).listInstances({ taskId: 't1' });

    expect(pool.values(0)).toEqual(['t1', 200]);
  });

  it('numbers each placeholder in the order the filters were added, with the limit last', async () => {
    const pool = fakePool();

    await new PgTaskInstanceDao(pool.asPool()).listInstances({ taskId: 't1', version: 3, agentId: 'mac-mini', status: 'running', limit: 10 });

    expect(pool.sql(0)).toContain('WHERE task_id = $1 AND task_version = $2 AND agent_id = $3 AND status = $4');
    expect(pool.sql(0)).toContain('LIMIT $5');
    expect(pool.values(0)).toEqual(['t1', 3, 'mac-mini', 'running', 10]);
  });

  it('numbers correctly when only a later filter is supplied', async () => {
    const pool = fakePool();

    // The bug this guards: numbering placeholders from the filter's fixed position
    // rather than from how many values have actually been pushed, which leaves $1
    // unbound the moment an earlier filter is omitted.
    await new PgTaskInstanceDao(pool.asPool()).listInstances({ status: 'exit_failure' });

    expect(pool.sql(0)).toContain('WHERE status = $1');
    expect(pool.values(0)).toEqual(['exit_failure', 200]);
  });

  it('treats the time window as half-open, so adjacent windows neither overlap nor gap', async () => {
    const pool = fakePool();

    await new PgTaskInstanceDao(pool.asPool()).listInstances({ from: CREATED_AT, to: UPDATED_AT });

    expect(pool.sql(0)).toContain('updated_at >= $1 AND updated_at < $2');
    // Dates, not epoch numbers: the column is a timestamptz.
    expect(pool.values(0)).toEqual([at(CREATED_AT), at(UPDATED_AT), 200]);
  });

  it('returns the newest first', async () => {
    const pool = fakePool().on('SELECT', { rows: [instanceRow({ instance_id: 'i2' }), instanceRow()] });

    const { instances } = await new PgTaskInstanceDao(pool.asPool()).listInstances({});

    expect(instances.map((instance) => instance.instanceId)).toEqual(['i2', 'i1']);
    expect(pool.sql(0)).toContain('ORDER BY updated_at DESC');
  });
});

describe('PgTaskInstanceDao.updateStatus', () => {
  it('applies the write and reports the status now stored', async () => {
    const pool = fakePool().on('UPDATE task_instance', { rows: [{ status: 'running' }] });

    const result = await new PgTaskInstanceDao(pool.asPool()).updateStatus({ instanceId: 'i1', status: 'running' });

    expect(result).toEqual({ found: true, applied: true, currentStatus: 'running' });
    // One statement, not read-then-write: the guard is in the WHERE clause precisely
    // so two concurrent reports cannot interleave.
    expect(pool.queries).toHaveLength(1);
  });

  it('guards on rank inside the UPDATE, allowing equal ranks through', async () => {
    const pool = fakePool().on('UPDATE task_instance', { rows: [{ status: 'health_check_failure' }] });

    await new PgTaskInstanceDao(pool.asPool()).updateStatus({ instanceId: 'i1', status: 'health_check_failure' });

    // `<=`, not `<`: running and health_check_failure share a rank, and a service
    // that recovers has to be able to move back.
    expect(pool.sql(0)).toContain('status_rank <= $3');
    expect(pool.values(0)).toEqual(['i1', 'health_check_failure', TASK_INSTANCE_STATUS_RANK.health_check_failure]);
  });

  it('reports a stale report as found but not applied, with the status that won', async () => {
    const pool = fakePool()
      .on('UPDATE task_instance', { rows: [] })
      .on('SELECT status', { rows: [{ status: 'exit_success' }] });

    const result = await new PgTaskInstanceDao(pool.asPool()).updateStatus({ instanceId: 'i1', status: 'running' });

    // A `running` arriving after `exit_success` is a reordered report, not an error:
    // the caller needs to know the write was dropped and what the truth is.
    expect(result).toEqual({ found: true, applied: false, currentStatus: 'exit_success' });
  });

  it('distinguishes a rejected write from a vanished instance', async () => {
    const pool = fakePool().on('UPDATE task_instance', { rows: [] }).on('SELECT status', { rows: [] });

    const result = await new PgTaskInstanceDao(pool.asPool()).updateStatus({ instanceId: 'gone', status: 'running' });

    // Both produce zero updated rows, so only the follow-up SELECT can tell them
    // apart — and the caller answers 404 for one and 200 for the other.
    expect(result).toEqual({ found: false, applied: false });
    expect(result.currentStatus).toBeUndefined();
  });
});

describe('PgTaskInstanceDao.setPid', () => {
  it('reports the instance as found when a row was updated', async () => {
    const pool = fakePool().on('UPDATE task_instance', { rowCount: 1 });

    expect(await new PgTaskInstanceDao(pool.asPool()).setPid({ instanceId: 'i1', pid: 4211 })).toEqual({ found: true });
    expect(pool.values(0)).toEqual(['i1', 4211]);
  });

  it('reports not found when the instance is gone', async () => {
    const pool = fakePool().on('UPDATE task_instance', { rowCount: 0 });

    expect(await new PgTaskInstanceDao(pool.asPool()).setPid({ instanceId: 'gone', pid: 4211 })).toEqual({ found: false });
  });

  it('treats a null rowCount as not found rather than crashing', async () => {
    // pg types rowCount as `number | null`, and it is null for statements that do not
    // report one. Reading `.rowCount > 0` off null would throw here.
    const pool = fakePool().on('UPDATE task_instance', { rowCount: null });

    expect(await new PgTaskInstanceDao(pool.asPool()).setPid({ instanceId: 'i1', pid: 4211 })).toEqual({ found: false });
  });

  it('stamps updated_at, so setting a pid keeps the instance out of a staleness sweep', async () => {
    const pool = fakePool().on('UPDATE task_instance', { rowCount: 1 });

    await new PgTaskInstanceDao(pool.asPool()).setPid({ instanceId: 'i1', pid: 4211 });

    expect(pool.sql(0)).toContain('updated_at = now()');
  });
});

describe('PgTaskInstanceDao.listStaleInstances', () => {
  it('sends the cutoff as a Date and filters on the exact status asked for', async () => {
    const pool = fakePool().on('SELECT', { rows: [instanceRow({ status: 'launched' })] });

    const { instances } = await new PgTaskInstanceDao(pool.asPool()).listStaleInstances({ status: 'launched', olderThan: UPDATED_AT });

    expect(pool.values(0)).toEqual(['launched', at(UPDATED_AT)]);
    expect(instances).toHaveLength(1);
  });
});

describe('PgTaskInstanceDao.deleteInstancesUpdatedBefore', () => {
  it('reports how many rows retention removed', async () => {
    const pool = fakePool().on('DELETE FROM task_instance', { rowCount: 7 });

    expect(await new PgTaskInstanceDao(pool.asPool()).deleteInstancesUpdatedBefore({ before: UPDATED_AT })).toEqual({ deletedCount: 7 });
    expect(pool.values(0)).toEqual([at(UPDATED_AT)]);
  });

  it('reports zero rather than null when the driver gives no count', async () => {
    const pool = fakePool().on('DELETE FROM task_instance', { rowCount: null });

    expect(await new PgTaskInstanceDao(pool.asPool()).deleteInstancesUpdatedBefore({ before: UPDATED_AT })).toEqual({ deletedCount: 0 });
  });
});

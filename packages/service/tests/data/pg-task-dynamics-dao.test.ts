import { InternalServiceError } from '@mini-cloud/shared';
import { PgTaskDynamicsDao } from '../../src/data/pg-task-dynamics-dao';
import { fakePool } from './test-helpers';

const dynamicsRow = (overrides: Record<string, unknown> = {}) => ({
  task_id: 't1',
  active: true,
  target_agent_ids: ['mac-mini'],
  ...overrides,
});

describe('PgTaskDynamicsDao.getDynamics', () => {
  it('maps the row onto the shared model', async () => {
    const pool = fakePool().on('SELECT', { rows: [dynamicsRow({ active: false, target_agent_ids: ['a', 'b'] })] });

    const { dynamics } = await new PgTaskDynamicsDao(pool.asPool()).getDynamics({ taskId: 't1' });

    expect(dynamics).toEqual({ taskId: 't1', active: false, targetAgentIds: ['a', 'b'] });
    expect(pool.values(0)).toEqual(['t1']);
  });

  it('returns null for a task that has never had dynamics written', async () => {
    const pool = fakePool();

    // Absent is not the same as inactive: a task with no dynamics row has never been
    // configured, and the service layer supplies the defaults rather than the DAO.
    expect((await new PgTaskDynamicsDao(pool.asPool()).getDynamics({ taskId: 't1' })).dynamics).toBeNull();
  });
});

describe('PgTaskDynamicsDao.setActive', () => {
  it('creates the row when absent and returns the whole resulting state', async () => {
    const pool = fakePool().on('INSERT INTO task_dynamics', { rows: [dynamicsRow({ active: true, target_agent_ids: [] })] });

    const { dynamics } = await new PgTaskDynamicsDao(pool.asPool()).setActive({ taskId: 't1', active: true });

    // An upsert, so activating a task nobody has targeted yet is not an error.
    expect(pool.sql(0)).toContain('ON CONFLICT (task_id) DO UPDATE');
    expect(dynamics).toEqual({ taskId: 't1', active: true, targetAgentIds: [] });
  });

  it('updates only `active`, leaving the target agents alone', async () => {
    const pool = fakePool().on('INSERT INTO task_dynamics', { rows: [dynamicsRow({ active: false })] });

    const { dynamics } = await new PgTaskDynamicsDao(pool.asPool()).setActive({ taskId: 't1', active: false });

    // Deactivating a task must not forget where it was targeted, or reactivating it
    // would silently launch nowhere.
    expect(pool.sql(0)).not.toContain('target_agent_ids = EXCLUDED');
    expect(dynamics.targetAgentIds).toEqual(['mac-mini']);
    expect(pool.values(0)).toEqual(['t1', false]);
  });

  it('fails loudly when the upsert returns no row', async () => {
    const pool = fakePool().on('INSERT INTO task_dynamics', { rows: [] });

    await expect(new PgTaskDynamicsDao(pool.asPool()).setActive({ taskId: 't1', active: true })).rejects.toThrow(InternalServiceError);
  });
});

describe('PgTaskDynamicsDao.setTargetAgents', () => {
  it('updates only the targets, leaving `active` alone', async () => {
    const pool = fakePool().on('INSERT INTO task_dynamics', { rows: [dynamicsRow({ target_agent_ids: ['a', 'b'] })] });

    const { dynamics } = await new PgTaskDynamicsDao(pool.asPool()).setTargetAgents({ taskId: 't1', targetAgentIds: ['a', 'b'] });

    expect(pool.sql(0)).not.toContain('active = EXCLUDED');
    expect(dynamics.targetAgentIds).toEqual(['a', 'b']);
  });

  it('binds a plain mutable array, which is what the pg array encoder accepts', async () => {
    const pool = fakePool().on('INSERT INTO task_dynamics', { rows: [dynamicsRow()] });
    const targetAgentIds: ReadonlyArray<string> = ['a', 'b'];

    await new PgTaskDynamicsDao(pool.asPool()).setTargetAgents({ taskId: 't1', targetAgentIds });

    const bound = pool.values(0)[1];
    expect(bound).toEqual(['a', 'b']);
    // Copied, not passed through: the caller's array is readonly by contract, and a
    // driver that mutated it in place would corrupt state the caller still holds.
    expect(bound).not.toBe(targetAgentIds);
  });

  it('accepts an empty target set, which is how a task is untargeted', async () => {
    const pool = fakePool().on('INSERT INTO task_dynamics', { rows: [dynamicsRow({ target_agent_ids: [] })] });

    const { dynamics } = await new PgTaskDynamicsDao(pool.asPool()).setTargetAgents({ taskId: 't1', targetAgentIds: [] });

    expect(dynamics.targetAgentIds).toEqual([]);
    expect(pool.values(0)).toEqual(['t1', []]);
  });

  it('fails loudly when the upsert returns no row', async () => {
    const pool = fakePool().on('INSERT INTO task_dynamics', { rows: [] });

    await expect(new PgTaskDynamicsDao(pool.asPool()).setTargetAgents({ taskId: 't1', targetAgentIds: [] })).rejects.toThrow(InternalServiceError);
  });
});

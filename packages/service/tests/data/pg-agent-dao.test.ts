import { InternalServiceError } from '@mini-cloud/shared';
import { PgAgentDao } from '../../src/data/pg-agent-dao';
import { at, fakePool } from './test-helpers';

const REGISTERED_AT = Date.UTC(2026, 0, 2, 3, 4, 5);
const LAST_SEEN_AT = Date.UTC(2026, 0, 9, 10, 11, 12);

const agentRow = (overrides: Record<string, unknown> = {}) => ({
  agent_id: 'mac-mini',
  name: 'Mac mini',
  status: 'online',
  last_seen_at: at(LAST_SEEN_AT),
  registered_at: at(REGISTERED_AT),
  ...overrides,
});

describe('PgAgentDao.recordHeartbeat', () => {
  it('maps the upserted row onto the shared model, timestamps as epoch ms', async () => {
    const pool = fakePool().on('INSERT INTO agent', { rows: [agentRow()] });

    const { agent } = await new PgAgentDao(pool.asPool()).recordHeartbeat({ agentId: 'mac-mini', name: 'Mac mini' });

    expect(agent).toEqual({
      agentId: 'mac-mini',
      name: 'Mac mini',
      status: 'online',
      lastSeenAt: LAST_SEEN_AT,
      registeredAt: REGISTERED_AT,
    });
  });

  it('binds the id and name, and leaves the timestamp to the database clock', async () => {
    const pool = fakePool().on('INSERT INTO agent', { rows: [agentRow()] });

    await new PgAgentDao(pool.asPool()).recordHeartbeat({ agentId: 'mac-mini', name: 'Mac mini' });

    expect(pool.values(0)).toEqual(['mac-mini', 'Mac mini']);
    // `now()` rather than a bound value: every agent's liveness is then judged against
    // one clock, not against whatever each machine believes the time is.
    expect(pool.sql(0)).toContain('now()');
  });

  it('fails loudly when the upsert returns nothing, because the caller has no agent to return', async () => {
    const pool = fakePool().on('INSERT INTO agent', { rows: [] });

    await expect(new PgAgentDao(pool.asPool()).recordHeartbeat({ agentId: 'mac-mini', name: 'Mac mini' })).rejects.toThrow(InternalServiceError);
  });

  it('reports an agent that has never been seen as having no last-seen time', async () => {
    const pool = fakePool().on('INSERT INTO agent', { rows: [agentRow({ last_seen_at: null })] });

    const { agent } = await new PgAgentDao(pool.asPool()).recordHeartbeat({ agentId: 'mac-mini', name: 'Mac mini' });

    // undefined, not null: the shared model marks the field optional, and a null
    // would survive JSON serialisation into the API response as an explicit null.
    expect(agent.lastSeenAt).toBeUndefined();
    expect('lastSeenAt' in agent).toBe(true);
  });

  it('refuses a status the model does not define rather than casting it through', async () => {
    const pool = fakePool().on('INSERT INTO agent', { rows: [agentRow({ status: 'draining' })] });

    await expect(new PgAgentDao(pool.asPool()).recordHeartbeat({ agentId: 'mac-mini', name: 'Mac mini' })).rejects.toThrow(InternalServiceError);
  });
});

describe('PgAgentDao.getAgent', () => {
  it('returns the agent when the row exists', async () => {
    const pool = fakePool().on('SELECT', { rows: [agentRow({ status: 'offline' })] });

    const { agent } = await new PgAgentDao(pool.asPool()).getAgent({ agentId: 'mac-mini' });

    expect(agent?.status).toBe('offline');
    expect(pool.values(0)).toEqual(['mac-mini']);
  });

  it('returns null for an unknown agent, so the caller decides whether that is a 404', async () => {
    const pool = fakePool();

    const { agent } = await new PgAgentDao(pool.asPool()).getAgent({ agentId: 'nobody' });

    expect(agent).toBeNull();
  });
});

describe('PgAgentDao.listAgents', () => {
  it('maps every row and asks the database for a stable order', async () => {
    const pool = fakePool().on('SELECT', { rows: [agentRow({ agent_id: 'a' }), agentRow({ agent_id: 'b' })] });

    const { agents } = await new PgAgentDao(pool.asPool()).listAgents({});

    expect(agents.map((agent) => agent.agentId)).toEqual(['a', 'b']);
    // Without an ORDER BY the console's agent list reshuffles between polls.
    expect(pool.sql(0)).toContain('ORDER BY name ASC');
  });

  it('returns an empty list rather than failing when no agent has ever registered', async () => {
    const pool = fakePool();

    expect((await new PgAgentDao(pool.asPool()).listAgents({})).agents).toEqual([]);
  });
});

describe('PgAgentDao.setStatus', () => {
  it('binds the id first and the status second, matching the placeholders', async () => {
    const pool = fakePool();

    await new PgAgentDao(pool.asPool()).setStatus({ agentId: 'mac-mini', status: 'offline' });

    // $1 is the id and $2 the status; swapping them writes the id into the status
    // column, which the CHECK constraint would reject only at runtime.
    expect(pool.sql(0)).toBe('UPDATE agent SET status = $2 WHERE agent_id = $1');
    expect(pool.values(0)).toEqual(['mac-mini', 'offline']);
  });
});

describe('PgAgentDao.expireAgents', () => {
  it('sends the cutoff as a Date, because the column is a timestamptz', async () => {
    const pool = fakePool().on('UPDATE agent', { rows: [] });

    await new PgAgentDao(pool.asPool()).expireAgents({ before: LAST_SEEN_AT });

    // Binding the raw epoch number would have pg compare a timestamptz to a bigint.
    expect(pool.values(0)).toEqual([at(LAST_SEEN_AT)]);
  });

  it('returns only the agents it actually moved offline', async () => {
    const pool = fakePool().on('UPDATE agent', { rows: [agentRow({ agent_id: 'stale', status: 'offline' })] });

    const { agents } = await new PgAgentDao(pool.asPool()).expireAgents({ before: LAST_SEEN_AT });

    // RETURNING over an UPDATE guarded on `status = 'online'` is what makes this the
    // set of transitions rather than the set of offline agents — the caller announces
    // each one, and announcing an agent that was already offline is a spurious event.
    expect(agents.map((agent) => agent.agentId)).toEqual(['stale']);
    expect(pool.sql(0)).toContain("WHERE status = 'online'");
    expect(pool.sql(0)).toContain('RETURNING');
  });

  it('treats an agent that never checked in as expirable', async () => {
    const pool = fakePool().on('UPDATE agent', { rows: [] });

    await new PgAgentDao(pool.asPool()).expireAgents({ before: LAST_SEEN_AT });

    // An agent registered but never seen has a NULL last_seen_at, and `NULL < $1` is
    // NULL, not true — so it would otherwise stay online forever.
    expect(pool.sql(0)).toContain('last_seen_at IS NULL OR last_seen_at < $1');
  });
});

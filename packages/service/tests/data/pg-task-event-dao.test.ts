import { PgTaskEventDao } from '../../src/data/pg-task-event-dao';
import { at, fakePool } from './test-helpers';

const OCCURRED_AT = Date.UTC(2026, 5, 1, 12, 0, 0);

const eventRow = (overrides: Record<string, unknown> = {}) => ({
  event_id: 'e1',
  instance_id: 'i1',
  source: 'agent',
  level: 'success',
  payload: { message: 'launched' },
  occurred_at: at(OCCURRED_AT),
  ...overrides,
});

const createInput = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'e1',
  instanceId: 'i1',
  source: 'agent' as const,
  level: 'success' as const,
  payload: { message: 'launched' },
  timestamp: OCCURRED_AT,
  ...overrides,
});

/** The shape pg raises for a foreign key violation. */
const foreignKeyViolation = (): Error => Object.assign(new Error('insert or update violates foreign key constraint'), { code: '23503' });

describe('PgTaskEventDao.createEvent', () => {
  it('serialises the payload for the JSONB column and sends the timestamp as a Date', async () => {
    const pool = fakePool();

    await new PgTaskEventDao(pool.asPool()).createEvent(createInput());

    expect(pool.values(0)).toEqual(['e1', 'i1', 'agent', 'success', '{"message":"launched"}', at(OCCURRED_AT)]);
  });

  it('stores a string payload as a JSON string, so it reads back as a string', async () => {
    const pool = fakePool();

    await new PgTaskEventDao(pool.asPool()).createEvent(createInput({ payload: 'agent reported pid 4211' }));

    // Quoted, not bare: JSONB round-trips `"..."` to a string, while a bare word is
    // not valid JSON at all and the insert would fail.
    expect(pool.values(0)[4]).toBe('"agent reported pid 4211"');
  });

  it('writes an absent payload as JSON null rather than as the string "undefined"', async () => {
    const pool = fakePool();

    await new PgTaskEventDao(pool.asPool()).createEvent(createInput({ payload: undefined }));

    // JSON.stringify(undefined) is undefined, which pg would bind as SQL NULL and the
    // NOT NULL column would reject.
    expect(pool.values(0)[4]).toBe('null');
  });

  it('drops an event whose instance was pruned out from under it, rather than failing the report', async () => {
    const pool = fakePool().failOn('INSERT INTO task_event', foreignKeyViolation());

    // Retention can delete an instance while a late event is still in flight. The
    // agent is reporting truthfully and has nowhere to put the event; failing its
    // request would make it retry something that can never succeed.
    await expect(new PgTaskEventDao(pool.asPool()).createEvent(createInput())).resolves.toEqual({});
  });

  it('still surfaces any other database failure', async () => {
    const pool = fakePool().failOn('INSERT INTO task_event', Object.assign(new Error('deadlock detected'), { code: '40P01' }));

    await expect(new PgTaskEventDao(pool.asPool()).createEvent(createInput())).rejects.toThrow('deadlock detected');
  });

  it('surfaces an error carrying no code at all', async () => {
    const pool = fakePool().failOn('INSERT INTO task_event', new Error('connection terminated'));

    await expect(new PgTaskEventDao(pool.asPool()).createEvent(createInput())).rejects.toThrow('connection terminated');
  });
});

describe('PgTaskEventDao.listEvents', () => {
  it('maps rows onto the shared model, oldest first', async () => {
    const pool = fakePool().on('SELECT', { rows: [eventRow(), eventRow({ event_id: 'e2', level: 'error', source: 'task' })] });

    const { events } = await new PgTaskEventDao(pool.asPool()).listEvents({ instanceId: 'i1', limit: 50 });

    expect(events).toEqual([
      { eventId: 'e1', instanceId: 'i1', source: 'agent', level: 'success', payload: { message: 'launched' }, timestamp: OCCURRED_AT },
      { eventId: 'e2', instanceId: 'i1', source: 'task', level: 'error', payload: { message: 'launched' }, timestamp: OCCURRED_AT },
    ]);
    // Ascending: an instance's events are a narrative, and reading it backwards is
    // wrong even though every other listing in the service is newest-first.
    expect(pool.sql(0)).toContain('ORDER BY occurred_at ASC');
  });

  it("passes the caller's limit to the database rather than trimming afterwards", async () => {
    const pool = fakePool().on('SELECT', { rows: [] });

    await new PgTaskEventDao(pool.asPool()).listEvents({ instanceId: 'i1', limit: 10 });

    expect(pool.values(0)).toEqual(['i1', 10]);
    expect(pool.sql(0)).toContain('LIMIT $2');
  });

  it('reads a JSONB payload back as whatever JSON it held', async () => {
    const pool = fakePool().on('SELECT', {
      rows: [eventRow({ payload: 'a plain string' }), eventRow({ event_id: 'e2', payload: null }), eventRow({ event_id: 'e3', payload: [1, 2] })],
    });

    const { events } = await new PgTaskEventDao(pool.asPool()).listEvents({ instanceId: 'i1', limit: 50 });

    expect(events.map((event) => event.payload)).toEqual(['a plain string', null, [1, 2]]);
  });
});

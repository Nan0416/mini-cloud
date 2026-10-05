import { PgNotifierDao } from '../../src/data/pg-notifier-dao';
import { fakePool } from './test-helpers';

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/secret-token';

const aRow = (overrides: Record<string, unknown> = {}) => ({
  notifier_id: 'ntf-a',
  name: 'Alerts',
  description: null,
  type: 'discord',
  settings: { channel: '#alerts', webhookId: '123' },
  version: 2,
  created_at: new Date(Date.UTC(2026, 9, 1)),
  updated_at: new Date(Date.UTC(2026, 9, 2)),
  ...overrides,
});

const TARGET = { type: 'discord' as const, channel: '#alerts', webhookId: '123' };

describe('PgNotifierDao', () => {
  it('maps a row into a notifier, with its target built from the type and settings', async () => {
    const pool = fakePool().on('WHERE notifier_id = $1', { rows: [aRow()] });

    const { notifier } = await new PgNotifierDao(pool.asPool()).getNotifier({ notifierId: 'ntf-a' });

    expect(notifier).toEqual({
      notifierId: 'ntf-a',
      name: 'Alerts',
      description: undefined,
      target: TARGET,
      version: 2,
      createdAt: Date.UTC(2026, 9, 1),
      updatedAt: Date.UTC(2026, 9, 2),
    });
  });

  it('never reads the secrets column outside delivery', async () => {
    const pool = fakePool().on('INSERT INTO notifier', { rows: [aRow()] });
    const dao = new PgNotifierDao(pool.asPool());

    await dao.listNotifiers({});
    await dao.getNotifier({ notifierId: 'ntf-a' });
    await dao.createNotifier({ notifierId: 'ntf-a', name: 'Alerts', target: TARGET, credentials: { type: 'discord', webhookUrl: WEBHOOK_URL } });

    for (const sql of pool.statements) {
      expect(sql).not.toMatch(/SELECT \*|RETURNING \*/);
      expect(sql.replace('INSERT INTO notifier (notifier_id, name, description, type, settings, secrets)', '')).not.toContain('secrets');
    }
  });

  it('refuses a row whose settings the type cannot be built from, as an internal error', async () => {
    const pool = fakePool().on('WHERE notifier_id = $1', { rows: [aRow({ settings: { channel: '#alerts' } })] });

    await expect(new PgNotifierDao(pool.asPool()).getNotifier({ notifierId: 'ntf-a' })).rejects.toThrow(/ntf-a has no settings.webhookId/);
  });

  it('stores the target and the credentials apart, each as JSON without its type', async () => {
    const pool = fakePool().on('INSERT INTO notifier', { rows: [aRow()] });

    await new PgNotifierDao(pool.asPool()).createNotifier({
      notifierId: 'ntf-a',
      name: 'Alerts',
      target: TARGET,
      credentials: { type: 'discord', webhookUrl: WEBHOOK_URL },
    });

    expect(pool.find('INSERT INTO notifier').values).toEqual(['ntf-a', 'Alerts', null, 'discord', '{"channel":"#alerts","webhookId":"123"}', `{"webhookUrl":"${WEBHOOK_URL}"}`]);
  });

  it('keeps the stored credentials on an update that brings none, and guards on version and name in one statement', async () => {
    const pool = fakePool();

    const { notifier } = await new PgNotifierDao(pool.asPool()).updateNotifier({ notifierId: 'ntf-a', version: 2, name: 'Alerts', target: TARGET });

    expect(notifier).toBeUndefined();
    expect(pool.sql(0)).toContain('secrets = COALESCE($7::jsonb, secrets)');
    expect(pool.sql(0)).toContain('WHERE notifier_id = $1 AND version = $2 AND NOT EXISTS (SELECT 1 FROM notifier other WHERE other.name = $3');
    expect(pool.values(0)[6]).toBeNull();
  });

  it('deletes nothing while a monitor sends to it, and says which monitors do', async () => {
    const pool = fakePool()
      .on('DELETE FROM notifier', { rows: [], rowCount: 0 })
      .on('SELECT monitor_name FROM monitor_notifier', { rows: [{ monitor_name: 'nas-cpu' }, { monitor_name: 'nas-disk' }] });

    const result = await new PgNotifierDao(pool.asPool()).deleteNotifier({ notifierId: 'ntf-a' });

    expect(pool.sql(0)).toContain('AND NOT EXISTS (SELECT 1 FROM monitor_notifier WHERE notifier_id = $1)');
    expect(result).toEqual({ deleted: false, usedBy: ['nas-cpu', 'nas-disk'] });
  });

  it('reports a rename that lost a race for its name as nothing written', async () => {
    const pool = fakePool().failOn('UPDATE notifier', Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'notifier_name_key' }));

    await expect(new PgNotifierDao(pool.asPool()).updateNotifier({ notifierId: 'ntf-a', version: 2, name: 'Alerts', target: TARGET })).resolves.toEqual({});
  });

  it('reports a delete that a monitor linking it got past the guard as in use, naming the monitor', async () => {
    const pool = fakePool()
      .failOn(
        'DELETE FROM notifier',
        Object.assign(new Error('violates RESTRICT setting of foreign key constraint'), { code: '23001', constraint: 'monitor_notifier_notifier_id_fkey' }),
      )
      .on('SELECT monitor_name FROM monitor_notifier', { rows: [{ monitor_name: 'nas-cpu' }] });

    await expect(new PgNotifierDao(pool.asPool()).deleteNotifier({ notifierId: 'ntf-a' })).resolves.toEqual({ deleted: false, usedBy: ['nas-cpu'] });
  });

  it('reports a delete that removed the row', async () => {
    const pool = fakePool().on('DELETE FROM notifier', { rows: [], rowCount: 1 });

    await expect(new PgNotifierDao(pool.asPool()).deleteNotifier({ notifierId: 'ntf-a' })).resolves.toEqual({ deleted: true, usedBy: [] });
  });

  it('reads credentials for delivery, and asks for nothing when given no ids', async () => {
    const pool = fakePool().on('ANY($1::text[])', { rows: [aRow({ secrets: { webhookUrl: WEBHOOK_URL } })] });
    const dao = new PgNotifierDao(pool.asPool());

    const none = await dao.listDeliveryTargets({ notifierIds: [] });
    const { targets } = await dao.listDeliveryTargets({ notifierIds: ['ntf-a'] });

    expect(none.targets).toEqual([]);
    expect(pool.queries).toHaveLength(1);
    expect(pool.values(0)).toEqual([['ntf-a']]);
    expect(targets).toEqual([{ notifier: expect.objectContaining({ notifierId: 'ntf-a', target: TARGET }), credentials: { type: 'discord', webhookUrl: WEBHOOK_URL } }]);
  });
});

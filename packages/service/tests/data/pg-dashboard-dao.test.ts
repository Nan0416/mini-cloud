import { PgDashboardDao } from '../../src/data/pg-dashboard-dao';
import { fakePool } from './test-helpers';

const aRow = (overrides: Record<string, unknown> = {}) => ({
  name: 'home',
  widgets: [],
  default_range: null,
  default_period_ms: null,
  version: 1,
  created_at: new Date(Date.UTC(2026, 8, 1)),
  updated_at: new Date(Date.UTC(2026, 8, 2)),
  ...overrides,
});

describe('PgDashboardDao', () => {
  it('maps a row, with absent defaults left out rather than null', async () => {
    const pool = fakePool().on('SELECT * FROM dashboard WHERE name', { rows: [aRow()] });

    const { dashboard } = await new PgDashboardDao(pool.asPool()).getDashboard({ name: 'home' });

    expect(dashboard).toEqual({
      name: 'home',
      widgets: [],
      defaultRange: undefined,
      defaultPeriodMs: undefined,
      version: 1,
      createdAt: Date.UTC(2026, 8, 1),
      updatedAt: Date.UTC(2026, 8, 2),
    });
  });

  it('reads the default period back as a number, though Postgres hands a BIGINT over as text', async () => {
    const pool = fakePool().on('SELECT * FROM dashboard WHERE name', { rows: [aRow({ default_period_ms: '300000' })] });

    const { dashboard } = await new PgDashboardDao(pool.asPool()).getDashboard({ name: 'home' });

    expect(dashboard?.defaultPeriodMs).toBe(300_000);
  });

  it('binds widgets and the range as JSON text, which is what a JSONB column takes', async () => {
    const pool = fakePool().on('INSERT INTO dashboard', { rows: [aRow()] });
    const widgets = [{ id: 'w1', queries: [] }];

    await new PgDashboardDao(pool.asPool()).createDashboard({ name: 'home', widgets, defaultRange: { kind: 'relative', durationMs: 60_000 } });

    expect(pool.find('INSERT INTO dashboard').values).toEqual(['home', JSON.stringify(widgets), '{"kind":"relative","durationMs":60000}', null]);
  });

  it('reports a taken name as nothing created', async () => {
    const pool = fakePool();

    expect((await new PgDashboardDao(pool.asPool()).createDashboard({ name: 'home', widgets: [] })).dashboard).toBeUndefined();
    expect(pool.sql(0)).toContain('ON CONFLICT (name) DO NOTHING');
  });

  it('guards an update on the version it was made from, in the same statement', async () => {
    const pool = fakePool();

    const { dashboard } = await new PgDashboardDao(pool.asPool()).updateDashboard({ name: 'home', version: 3, widgets: [] });

    expect(dashboard).toBeUndefined();
    expect(pool.sql(0)).toContain('WHERE name = $1 AND version = $2');
    expect(pool.values(0).slice(0, 2)).toEqual(['home', 3]);
  });
});

import { Dashboard, DashboardWidget, MetricTimeRange } from '@mini-cloud/shared';
import { Pool } from 'pg';
import {
  CreateDashboardInput,
  CreateDashboardOutput,
  DashboardDao,
  DeleteDashboardInput,
  DeleteDashboardOutput,
  GetDashboardInput,
  GetDashboardOutput,
  ListDashboardsInput,
  ListDashboardsOutput,
  UpdateDashboardInput,
  UpdateDashboardOutput,
} from './dashboard-dao';

interface DashboardRow {
  readonly name: string;
  readonly widgets: ReadonlyArray<DashboardWidget>;
  readonly default_range: MetricTimeRange | null;
  // BIGINT, which node-postgres returns as a string so as not to lose precision.
  readonly default_period_ms: string | null;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function toDashboard(row: DashboardRow): Dashboard {
  return {
    name: row.name,
    widgets: row.widgets,
    defaultRange: row.default_range ?? undefined,
    defaultPeriodMs: row.default_period_ms === null ? undefined : Number(row.default_period_ms),
    version: row.version,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

// JSONB parameters are bound as JSON text: node-postgres would send a JS array as a
// Postgres array literal, which a JSONB column refuses.
const toJson = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));

export class PgDashboardDao implements DashboardDao {
  constructor(private readonly pool: Pool) {}

  async listDashboards(_input: ListDashboardsInput): Promise<ListDashboardsOutput> {
    const result = await this.pool.query<DashboardRow>('SELECT * FROM dashboard ORDER BY name ASC');
    return { dashboards: result.rows.map(toDashboard) };
  }

  async getDashboard(input: GetDashboardInput): Promise<GetDashboardOutput> {
    const result = await this.pool.query<DashboardRow>('SELECT * FROM dashboard WHERE name = $1', [input.name]);
    const row = result.rows[0];
    return { dashboard: row === undefined ? undefined : toDashboard(row) };
  }

  async createDashboard(input: CreateDashboardInput): Promise<CreateDashboardOutput> {
    // DO NOTHING rather than a read first, so two creates of one name cannot both succeed.
    const result = await this.pool.query<DashboardRow>(
      `INSERT INTO dashboard (name, widgets, default_range, default_period_ms)
       VALUES ($1, $2::jsonb, $3::jsonb, $4)
       ON CONFLICT (name) DO NOTHING
       RETURNING *`,
      [input.name, toJson(input.widgets), toJson(input.defaultRange), input.defaultPeriodMs ?? null],
    );
    const row = result.rows[0];
    return { dashboard: row === undefined ? undefined : toDashboard(row) };
  }

  async updateDashboard(input: UpdateDashboardInput): Promise<UpdateDashboardOutput> {
    const result = await this.pool.query<DashboardRow>(
      `UPDATE dashboard
          SET widgets = $3::jsonb, default_range = $4::jsonb, default_period_ms = $5, version = version + 1, updated_at = now()
        WHERE name = $1 AND version = $2
        RETURNING *`,
      [input.name, input.version, toJson(input.widgets), toJson(input.defaultRange), input.defaultPeriodMs ?? null],
    );
    const row = result.rows[0];
    return { dashboard: row === undefined ? undefined : toDashboard(row) };
  }

  async deleteDashboard(input: DeleteDashboardInput): Promise<DeleteDashboardOutput> {
    const result = await this.pool.query('DELETE FROM dashboard WHERE name = $1', [input.name]);
    return { deleted: (result.rowCount ?? 0) > 0 };
  }
}

import { Dashboard, DashboardWidget, MetricTimeRange } from '@mini-cloud/shared';

export interface ListDashboardsInput {}

export interface ListDashboardsOutput {
  readonly dashboards: ReadonlyArray<Dashboard>;
}

export interface GetDashboardInput {
  readonly name: string;
}

export interface GetDashboardOutput {
  readonly dashboard?: Dashboard;
}

export interface CreateDashboardInput {
  readonly name: string;
  readonly widgets: ReadonlyArray<DashboardWidget>;
  readonly defaultRange?: MetricTimeRange;
  readonly defaultPeriodMs?: number;
}

export interface CreateDashboardOutput {
  /** Absent when the name was already taken, and nothing was written. */
  readonly dashboard?: Dashboard;
}

export interface UpdateDashboardInput {
  readonly name: string;
  /** Written only if this is still the stored version. */
  readonly version: number;
  readonly widgets: ReadonlyArray<DashboardWidget>;
  readonly defaultRange?: MetricTimeRange;
  readonly defaultPeriodMs?: number;
}

export interface UpdateDashboardOutput {
  /** Absent when no dashboard of that name holds that version, and nothing was written. */
  readonly dashboard?: Dashboard;
}

export interface DeleteDashboardInput {
  readonly name: string;
}

export interface DeleteDashboardOutput {
  readonly deleted: boolean;
}

export interface DashboardDao {
  listDashboards(input: ListDashboardsInput): Promise<ListDashboardsOutput>;
  getDashboard(input: GetDashboardInput): Promise<GetDashboardOutput>;
  createDashboard(input: CreateDashboardInput): Promise<CreateDashboardOutput>;
  updateDashboard(input: UpdateDashboardInput): Promise<UpdateDashboardOutput>;
  deleteDashboard(input: DeleteDashboardInput): Promise<DeleteDashboardOutput>;
}

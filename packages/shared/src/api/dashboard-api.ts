import { Dashboard, DashboardContent } from '../models/dashboard';

export interface ListDashboardsRequest {}

export interface ListDashboardsResponse {
  /** By name. */
  readonly dashboards: ReadonlyArray<Dashboard>;
}

export interface GetDashboardRequest {
  readonly name: string;
}

export interface GetDashboardResponse {
  readonly dashboard: Dashboard;
}

/** Refused with a conflict when the name is taken, so a create never replaces a dashboard. */
export interface CreateDashboardRequest extends DashboardContent {
  readonly name: string;
}

export interface CreateDashboardResponse {
  readonly dashboard: Dashboard;
}

/** Replaces the whole content, and only if `version` is still the stored one. */
export interface UpdateDashboardRequest extends DashboardContent {
  readonly name: string;
  /** The version this edit was made from. */
  readonly version: number;
}

export interface UpdateDashboardResponse {
  readonly dashboard: Dashboard;
}

export interface DeleteDashboardRequest {
  readonly name: string;
}

export interface DeleteDashboardResponse {}

import { Monitor, MonitorDefinition, MonitorStateChange } from '../models/monitor';

/** Most state changes one history request returns, newest first. */
export const MONITOR_HISTORY_PAGE_SIZE = { default: 50, max: 500 } as const;

export interface ListMonitorsRequest {}

export interface ListMonitorsResponse {
  /** By name. */
  readonly monitors: ReadonlyArray<Monitor>;
}

export interface GetMonitorRequest {
  readonly name: string;
}

export interface GetMonitorResponse {
  readonly monitor: Monitor;
}

/** Refused with a conflict when the name is taken. A new monitor starts in `INSUFFICIENT_DATA`. */
export interface CreateMonitorRequest extends MonitorDefinition {
  readonly name: string;
}

export interface CreateMonitorResponse {
  readonly monitor: Monitor;
}

/** Replaces the whole definition, and only if `version` is still the stored one. The state is left for the next evaluation. */
export interface UpdateMonitorRequest extends MonitorDefinition {
  readonly name: string;
  /** The version this edit was made from. */
  readonly version: number;
}

export interface UpdateMonitorResponse {
  readonly monitor: Monitor;
}

export interface DeleteMonitorRequest {
  readonly name: string;
}

export interface DeleteMonitorResponse {}

export interface ListMonitorHistoryRequest {
  readonly name: string;
  readonly limit?: number;
}

export interface ListMonitorHistoryResponse {
  /** Newest first. */
  readonly changes: ReadonlyArray<MonitorStateChange>;
}

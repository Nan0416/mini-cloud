import { Monitor, MonitorDefinition, MonitorStateChange } from '../models/monitor';

/** Most state changes one history request returns, newest first. */
export const MONITOR_HISTORY_PAGE_SIZE = { default: 20, max: 500 } as const;

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

/** Paged by keyset, like the metric listings, so a change recorded while paging cannot shift an older page. */
export interface ListMonitorHistoryRequest {
  readonly name: string;
  readonly limit?: number;
  /** The previous page's `nextCursor`. Omit for the newest page. */
  readonly after?: number;
}

export interface ListMonitorHistoryResponse {
  /** Newest first. */
  readonly changes: ReadonlyArray<MonitorStateChange>;
  /** Pass back as `after`. Absent when this was the oldest page. */
  readonly nextCursor?: number;
}

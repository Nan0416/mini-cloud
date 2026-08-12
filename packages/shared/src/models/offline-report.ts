import { TaskEventLevel } from './task-instance';

/**
 * Environment the agent injects into every process it launches. `@mini-cloud/reporter`
 * reads these to find out who it is and where to report.
 */
export const REPORTER_ENV = {
  instanceId: 'MINI_CLOUD_INSTANCE_ID',
  taskId: 'MINI_CLOUD_TASK_ID',
  taskVersion: 'MINI_CLOUD_TASK_VERSION',
  agentId: 'MINI_CLOUD_AGENT_ID',
  agentUrl: 'MINI_CLOUD_AGENT_URL',
  offlineReportPath: 'MINI_CLOUD_OFFLINE_REPORT_PATH',
  healthCheckPeriodMs: 'MINI_CLOUD_HEALTH_CHECK_PERIOD_MS',
} as const;

export type OfflineReportType = 'pid' | 'exit' | 'termination' | 'event';

interface BaseOfflineReport {
  readonly version: 1;
  readonly type: OfflineReportType;
  readonly instanceId: string;
  readonly timestamp: number;
}

export interface OfflinePidReport extends BaseOfflineReport {
  readonly type: 'pid';
  readonly pid: number;
}

export interface OfflineExitReport extends BaseOfflineReport {
  readonly type: 'exit';
  /** The process's own exit code. Zero is success; anything else is a failure. */
  readonly code: number;
}

export interface OfflineTerminationReport extends BaseOfflineReport {
  readonly type: 'termination';
}

export interface OfflineEventReport extends BaseOfflineReport {
  readonly type: 'event';
  readonly level: TaskEventLevel;
  readonly payload: unknown;
}

/**
 * A report a task could not deliver because its agent was down.
 *
 * Written as one JSON object per line to an append-only file, which makes the format
 * crash-safe: a process killed mid-write loses at most the final partial line, and
 * the agent replays the rest on its next start.
 */
export type OfflineReport = OfflinePidReport | OfflineExitReport | OfflineTerminationReport | OfflineEventReport;

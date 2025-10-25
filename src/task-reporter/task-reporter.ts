import { TaskEventLevel } from '../models';

/**
 * task reporter will save the event to fs when task agent is offline
 */
export type OfflineTaskReportType = 'pid' | 'exit' | 'termination' | 'event';

interface BaseOfflineTaskReport {
  readonly version: string;
  readonly type: OfflineTaskReportType;
  readonly timestamp: number;
  readonly instanceId: string;
}

export interface OfflinePidTaskReport extends BaseOfflineTaskReport {
  readonly type: 'pid';
  readonly version: '1.0.0';
  readonly pid: number;
}

export type ExitCode = 0 | -1;

export interface OfflineExitTaskReport extends BaseOfflineTaskReport {
  readonly type: 'exit';
  readonly version: '1.0.0';
  readonly code?: ExitCode;
}

export interface OfflineTerminationTaskReport extends BaseOfflineTaskReport {
  readonly type: 'termination';
  readonly version: '1.0.0';
}

export interface OfflineEventTaskReport extends BaseOfflineTaskReport {
  readonly type: 'event';
  readonly version: '1.0.0';
  readonly level: TaskEventLevel;
  readonly payload: any;
}

export type OfflineTaskReport = OfflinePidTaskReport | OfflineExitTaskReport | OfflineTerminationTaskReport | OfflineEventTaskReport;

/**
 * task instance -> task agent,
 *
 * Used by task instance, implementation never fails.
 * Implementation may also implement and start passive health check.
 */
export interface TaskReporter {
  reportPid(): Promise<void>;
  reportTermination(): Promise<void>;
  reportExit(number?: ExitCode): Promise<void>;
  log(level: TaskEventLevel, payload: any): Promise<void>;
}

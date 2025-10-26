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

export interface ReportPidRequest {
  readonly taskInstanceId: string;
  readonly pid: number;
}

export interface ReportPidResponse {}

export interface ReportTerminationRequest {
  readonly taskInstanceId: string;
}

export interface ReportTerminationResponse {}

export interface ReportExitRequest {
  readonly taskInstanceId: string;
  readonly code?: ExitCode;
}

export interface ReportExitResponse {}

export interface ReportEventRequest {
  readonly taskInstanceId: string;
  readonly timestamp: number;
  readonly level: TaskEventLevel;
  readonly payload: any;
}

export interface ReportEventResponse {}

export interface ReportPassiveHealthCheckRequest {
  readonly taskInstanceId: string;
}

export interface ReportPassiveHealthCheckResponse {}

/**
 * task instance -> task agent,
 *
 * Used by task instance, implementation never fails.
 * Implementation may also implement and start passive health check.
 */
export interface TaskReporterClient {
  reportPid(request: ReportPidRequest): Promise<ReportPidResponse>;
  reportTermination(request: ReportTerminationRequest): Promise<ReportTerminationResponse>;
  reportExit(request: ReportExitRequest): Promise<ReportExitResponse>;
  reportEvent(request: ReportEventRequest): Promise<ReportEventResponse>;

  /**
   * If the task is a service, then the agent will ping the task service for health check.
   * On the other hand, if the task is a background job, the task instance should ping the agent to indicate it's still alive.
   */
  reportPassiveHealthCheck(request: ReportPassiveHealthCheckRequest): Promise<ReportPassiveHealthCheckResponse>;
}

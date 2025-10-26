import { TaskEventFormat, TaskEventLevel, TaskInstance, TaskInstanceStatus } from '../models';
import { TaskIdentifier, TaskIdentifierWithHealthCheck } from './task-request-response';

export interface ListRunningInstancesRequest {
  readonly agentId: string;
}

export interface ListRunningInstancesResponse {
  readonly taskInstances: TaskInstance[];
}

export interface ListHealthChecksRequest {
  readonly taskIdentifiers: TaskIdentifier[];
}

export interface ListHealthChecksResponse {
  readonly results: TaskIdentifierWithHealthCheck[];
}

export interface ReportTaskEventRequest {
  readonly taskInstanceId: string;
  readonly source: 'task-agent' | 'task-instance';
  readonly timestamp: number;
  readonly level: TaskEventLevel;
  readonly format: TaskEventFormat;
  readonly payload: any;
}

export interface ReportTaskEventReponse {}

export interface ReportTaskInstancePidRequest {
  readonly taskInstanceId: string;
  readonly pid: number;
}

export interface ReportTaskInstancePidResponse {}

export interface ReportTaskInstanceStatusRequest {
  readonly taskInstanceId: string;
  readonly status: TaskInstanceStatus;
}

export interface ReportTaskInstanceStatusResponse {}

export interface ReportAgentStatusRequest {
  readonly agentId: string;
  readonly name?: string;
}

export interface ReportAgentStatusResponse {}

// Used by task agent.
export interface TaskClientForAgent {
  /**
   * During the agent restart, it will first list running instances on the agent by asking the task service.
   * And after knowing these running tasks, it will re-start health check for these running instances.
   */
  listRunningInstances(request: ListRunningInstancesRequest): Promise<ListRunningInstancesResponse>;
  listHealthChecks(request: ListHealthChecksRequest): Promise<ListHealthChecksResponse>;

  reportTaskEvent(request: ReportTaskEventRequest): Promise<ReportTaskEventReponse>;
  /**
   *
   * @param taskInstanceId
   * @param pid
   */
  reportTaskInstancePid(request: ReportTaskInstancePidRequest): Promise<ReportTaskInstancePidResponse>;
  reportTaskInstanceStatus(request: ReportTaskInstanceStatusRequest): Promise<ReportTaskInstanceStatusResponse>;
  reportAgentStatus(request: ReportAgentStatusRequest): Promise<ReportAgentStatusResponse>;
}

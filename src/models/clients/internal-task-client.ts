import { NewTaskEvent, TaskInstance } from '../models';
import { TaskIdentifier, TaskIdentifierWithHealthCheck } from './task-request-response';

export interface ListRunningInstancesRequest {}

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
  readonly event: NewTaskEvent;
}

export interface ReportTaskEventReponse {}

export interface ReportTaskInstancePidRequest {
  readonly taskInstanceId: string;
  readonly pid: number;
}

export interface ReportTaskInstancePidResponse {}

export interface ReportTaskInstanceStatusRequest {
  readonly taskInstanceId: string;
  readonly pid: number;
}

export interface ReportTaskInstanceStatusResponse {}

export interface ReportAgentStatusRequest {
  readonly agentId: string;
}

export interface ReportAgentStatusResponse {}

// Used by task agent.
export interface InternalTaskClient {
  /**
   * running instances on the agent.
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

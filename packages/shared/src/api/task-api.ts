import { EnvironmentVariables, ReplacementVariables } from '../models/common';
import { HealthCheck, Task, TaskDynamics, TaskIdentifierWithHealthCheck, TaskType } from '../models/task';
import { TaskEvent, TaskInstance, TaskInstanceStatus } from '../models/task-instance';

interface BaseWriteTaskFields {
  readonly name: string;
  readonly description?: string;
  readonly type: TaskType;
  readonly cmd: string;
  readonly cwd: string;
  readonly arguments?: ReadonlyArray<string>;
  readonly env?: EnvironmentVariables;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface CreateServiceRequest extends BaseWriteTaskFields {
  readonly type: 'service';
  readonly healthCheck?: HealthCheck;
}

export interface CreateJobRequest extends BaseWriteTaskFields {
  readonly type: 'job';
  readonly duration?: number;
  readonly firstLaunchAt?: number;
}

export type CreateTaskRequest = CreateServiceRequest | CreateJobRequest;

export interface CreateTaskResponse {
  readonly taskId: string;
  readonly version: number;
}

export interface UpdateServiceRequest extends BaseWriteTaskFields {
  readonly taskId: string;
  readonly type: 'service';
  readonly healthCheck?: HealthCheck;
}

export interface UpdateJobRequest extends BaseWriteTaskFields {
  readonly taskId: string;
  readonly type: 'job';
  readonly duration?: number;
  readonly firstLaunchAt?: number;
}

export type UpdateTaskRequest = UpdateServiceRequest | UpdateJobRequest;

export interface UpdateTaskResponse {
  readonly taskId: string;
  readonly version: number;
}

export interface DeleteTaskRequest {
  readonly taskId: string;
}

export interface DeleteTaskResponse {}

export interface GetTaskRequest {
  readonly taskId: string;
  /** Omit for the latest version. */
  readonly version?: number;
}

export interface GetTaskResponse {
  readonly task: Task;
}

export interface ListTasksRequest {}

export interface ListTasksResponse {
  readonly tasks: ReadonlyArray<Task>;
}

export interface GetTaskDynamicsRequest {
  readonly taskId: string;
}

export interface GetTaskDynamicsResponse {
  readonly dynamics: TaskDynamics;
}

export interface SetTaskActiveRequest {
  readonly taskId: string;
  readonly active: boolean;
}

export interface SetTaskActiveResponse {
  readonly dynamics: TaskDynamics;
}

export interface SetTaskTargetAgentsRequest {
  readonly taskId: string;
  readonly targetAgentIds: ReadonlyArray<string>;
}

export interface SetTaskTargetAgentsResponse {
  readonly dynamics: TaskDynamics;
}

export interface LaunchTaskRequest {
  readonly taskId: string;
  /** Omit to use the task's configured target agents. */
  readonly targetAgentIds?: ReadonlyArray<string>;
  /** Appended to the task's own arguments for this launch only. */
  readonly arguments?: ReadonlyArray<string>;
}

/** Outcome of dispatching one launch to one agent. */
export interface LaunchResult {
  readonly taskId: string;
  readonly taskVersion: number;
  readonly instanceId: string;
  readonly agentId: string;
  readonly status: 'initiated' | 'initiation_failed';
  /** Why dispatch failed, when it did. */
  readonly message?: string;
}

export interface LaunchTaskResponse {
  readonly results: ReadonlyArray<LaunchResult>;
}

export interface GetTaskInstanceRequest {
  readonly instanceId: string;
}

export interface GetTaskInstanceResponse {
  readonly instance: TaskInstance;
}

export interface ListTaskInstancesRequest {
  readonly taskId?: string;
  /** Only valid together with `taskId`. */
  readonly version?: number;
  readonly agentId?: string;
  readonly status?: TaskInstanceStatus;
  /** Last-updated window, epoch ms, half-open `[from, to)`. */
  readonly from?: number;
  readonly to?: number;
  readonly limit?: number;
}

export interface ListTaskInstancesResponse {
  readonly instances: ReadonlyArray<TaskInstance>;
}

export interface TerminateTaskInstanceRequest {
  readonly instanceId: string;
}

export interface TerminateTaskInstanceResponse {}

export interface ListTaskEventsRequest {
  readonly instanceId: string;
  readonly limit?: number;
}

export interface ListTaskEventsResponse {
  readonly events: ReadonlyArray<TaskEvent>;
}

export interface ListReplacementVariablesRequest {}

export interface ListReplacementVariablesResponse {
  readonly variables: ReplacementVariables;
}

export interface SetReplacementVariablesRequest {
  readonly variables: ReplacementVariables;
}

export interface SetReplacementVariablesResponse {
  readonly variables: ReplacementVariables;
}

export interface ListHealthChecksRequest {
  readonly taskIdentifiers: ReadonlyArray<{ readonly taskId: string; readonly version: number }>;
}

export interface ListHealthChecksResponse {
  readonly healthChecks: ReadonlyArray<TaskIdentifierWithHealthCheck>;
}

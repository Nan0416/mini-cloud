import { EnvironmentVariables, ReplacementVariables } from '../models/task-types/common';
import { HealthCheck, Task, TaskDynamics, TaskEvent, TaskInstance, TaskInstanceStatus, TaskType, TaskAgent } from '../models/task-types/common';

export interface ListTasksRequest {}

export interface ListTasksResponse {
  readonly tasks: Task[];
  // todo: add pagination
}

export interface GetTaskRequest {
  readonly taskId: string;
  readonly version?: number;
}

export interface GetTaskResponse {
  readonly task: Task;
}

export interface GetTaskDynamicsRequest {
  readonly taskId: string;
}

export interface GetTaskDynamicsResponse {
  readonly taskDynamics: TaskDynamics;
}

export interface ResetTaskActiveRequest {
  readonly taskId: string;
  readonly active: boolean;
}

export interface ResetTaskActiveResponse {}

export interface ResetTaskTargetAgentsRequest {
  readonly taskId: string;
  readonly targetAgentIds: string[];
}

export interface ResetTaskTargetAgentsResponse {}

export interface GetTaskInstanceRequest {
  readonly taskInstanceId: string;
}

export interface GetTaskInstanceResponse {
  readonly taskInstance: TaskInstance;
}

export interface ListTaskInstancesRequest {
  readonly taskId?: string;
  readonly version?: number;
  readonly agentId?: string;
  readonly status?: TaskInstanceStatus;
  // updated window [from, to)
  readonly from?: number;
  readonly to?: number;
}

export interface ListTaskInstancesResponse {
  readonly taskInstances: TaskInstance[];
}

export interface TaskIdentifier {
  readonly taskId: string;
  readonly version: number;
}

export interface TaskIdentifierWithHealthCheck extends TaskIdentifier {
  readonly healthCheck: HealthCheck;
}

export interface LaunchTaskRequest {
  readonly taskId: string;
  readonly targetAgentIds: string[];
  readonly arguments?: string[];
}

export interface LaunchTaskInstanceResult {
  readonly taskId: string;
  readonly taskVersion: number;
  readonly instanceId: string;
  readonly agentId: string;
  readonly status: 'initiated' | 'initiation_failed';
}

export interface LaunchTaskResponse {
  readonly results: LaunchTaskInstanceResult[];
}

export interface ListReplacementVariablesRequest {}

export interface ListReplacementVariablesResponse {
  readonly variables: ReplacementVariables;
}

export interface ResetReplacementVariablesRequest {
  readonly variables: ReplacementVariables;
}

export interface ResetReplacementVariablesResponse {
  readonly message: string;
}

export interface ListTaskEventsRequest {
  readonly taskInstanceId: string;
}

export interface ListTaskEventsResponse {
  readonly taskEvents: TaskEvent[];
}

export interface TerminateTaskInstanceRequest {
  readonly taskInstanceId: string;
}

export interface TerminateTaskInstanceResponse {}

export interface ListTaskAgentsRequest {}

export interface ListTaskAgentsResponse {
  readonly agents: TaskAgent[];
}

export interface TerminateTaskAgentRequest {
  readonly agentId: string;
}

export interface TerminateTaskAgentResponse {}

interface BaseCreateTaskRequest {
  readonly name: string;
  readonly description?: string;
  readonly type: TaskType;
  readonly cmd: string;
  readonly cwd: string;
  readonly arguments?: string[];
  readonly env?: EnvironmentVariables;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface CreateServiceRequest extends BaseCreateTaskRequest {
  readonly type: 'service';
  readonly healthCheck?: HealthCheck;
}

export interface CreateJobRequest extends BaseCreateTaskRequest {
  readonly type: 'job';
  readonly duration?: number;
  readonly firstLaunchAt?: number;
}

export type CreateTaskRequest = CreateServiceRequest | CreateJobRequest;

export interface CreateTaskResponse {
  readonly taskId: string;
  readonly version: number;
}

interface BaseUpdateTaskRequest {
  readonly taskId: string;
  readonly name: string;
  readonly description?: string;
  readonly type: TaskType;
  readonly cmd: string;
  readonly cwd: string;
  readonly arguments?: string[];
  readonly env?: EnvironmentVariables;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface UpdateServiceRequest extends BaseUpdateTaskRequest {
  readonly type: 'service';
  readonly healthCheck?: HealthCheck;
}

export interface UpdateJobRequest extends BaseUpdateTaskRequest {
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

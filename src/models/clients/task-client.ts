import {
  CreateTaskRequest,
  CreateTaskResponse,
  DeleteTaskRequest,
  DeleteTaskResponse,
  GetTaskDynamicsRequest,
  GetTaskDynamicsResponse,
  GetTaskInstanceRequest,
  GetTaskInstanceResponse,
  GetTaskRequest,
  GetTaskResponse,
  LaunchTaskRequest,
  LaunchTaskResponse,
  ListReplacementVariablesRequest,
  ListReplacementVariablesResponse,
  ListTaskAgentsRequest,
  ListTaskAgentsResponse,
  ListTaskEventsRequest,
  ListTaskEventsResponse,
  ListTaskInstancesRequest,
  ListTaskInstancesResponse,
  ListTasksRequest,
  ListTasksResponse,
  ResetReplacementVariablesRequest,
  ResetReplacementVariablesResponse,
  ResetTaskActiveRequest,
  ResetTaskActiveResponse,
  ResetTaskTargetAgentsRequest,
  ResetTaskTargetAgentsResponse,
  TerminateTaskAgentRequest,
  TerminateTaskAgentResponse,
  TerminateTaskInstanceRequest,
  TerminateTaskInstanceResponse,
  UpdateTaskRequest,
  UpdateTaskResponse,
} from './task-request-response';

export interface TaskClient {
  createTask(request: CreateTaskRequest): Promise<CreateTaskResponse>;
  updateTask(request: UpdateTaskRequest): Promise<UpdateTaskResponse>;
  deleteTask(request: DeleteTaskRequest): Promise<DeleteTaskResponse>;
  getTask(request: GetTaskRequest): Promise<GetTaskResponse>;
  getTaskDynamics(request: GetTaskDynamicsRequest): Promise<GetTaskDynamicsResponse>;
  resetTaskActive(request: ResetTaskActiveRequest): Promise<ResetTaskActiveResponse>;
  resetTaskTargetAgents(request: ResetTaskTargetAgentsRequest): Promise<ResetTaskTargetAgentsResponse>;
  listTasks(request: ListTasksRequest): Promise<ListTasksResponse>;
  getTaskInstance(request: GetTaskInstanceRequest): Promise<GetTaskInstanceResponse>;
  listTaskInstances(request: ListTaskInstancesRequest): Promise<ListTaskInstancesResponse>;
  listTaskEvents(request: ListTaskEventsRequest): Promise<ListTaskEventsResponse>;
  launchTask(request: LaunchTaskRequest): Promise<LaunchTaskResponse>;
  terminateTaskInstance(request: TerminateTaskInstanceRequest): Promise<TerminateTaskInstanceResponse>;
  listTaskAgents(request: ListTaskAgentsRequest): Promise<ListTaskAgentsResponse>;
  terminateTaskAgent(request: TerminateTaskAgentRequest): Promise<TerminateTaskAgentResponse>;
  listReplacementVariables(request: ListReplacementVariablesRequest): Promise<ListReplacementVariablesResponse>;
  resetReplacementVariables(request: ResetReplacementVariablesRequest): Promise<ResetReplacementVariablesResponse>;
}

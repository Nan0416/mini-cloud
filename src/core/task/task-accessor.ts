import {
  CreateTaskRequest,
  Task,
  TaskDynamics,
  TaskEvent,
  TaskEventFormat,
  TaskEventLevel,
  TaskEventSource,
  TaskIdentifier,
  TaskIdentifierWithHealthCheck,
  TaskInstance,
  TaskInstanceStatus,
  UpdateTaskRequest,
} from '../../models';

export type CreateTaskInput = CreateTaskRequest;

export interface CreateTaskOutput {
  readonly taskId: string;
  readonly version: number;
}

export type UpdateTaskInput = UpdateTaskRequest;

export interface UpdateTaskOutput {
  readonly taskId: string;
  readonly version: number;
}

export interface DeleteTaskInput {
  readonly taskId: string;
}

export interface DeleteTaskOutput {}

export interface GetTaskInput {
  readonly taskId: string;
  readonly version?: number;
}

export interface GetTaskOutput {
  readonly task: Task;
}

export interface ListLatestTasksInput {}

export interface ListLatestTasksOutput {
  readonly tasks: Task[];
}

export interface ListHealthChecksInput {
  readonly taskIdentifiers: TaskIdentifier[];
}

export interface ListHealthChecksOutput {
  readonly healthChecks: TaskIdentifierWithHealthCheck[];
}

export interface GetTaskDynamicsInput {
  readonly taskId: string;
}

export interface GetTaskDynamicsOutput {
  readonly taskDynamics: TaskDynamics;
}

export interface ResetTaskActiveInput {
  readonly taskId: string;
  readonly active: boolean;
}

export interface ResetTaskActiveOutput {}

export interface ResetTaskTargetAgentsInput {
  readonly taskId: string;
  readonly targetAgentIds: string[];
}

export interface ResetTaskTargetAgentsOutput {}

export interface CreateTaskInstanceInput {
  readonly taskId: string;
  readonly version: number;
  readonly agentId: string;
}

export interface CreateTaskInstanceOutput {
  readonly taskInstanceId: string;
}

export interface GetTaskInstanceInput {
  readonly taskInstanceId: string;
}

export interface GetTaskInstanceOutput {
  readonly taskInstance: TaskInstance;
}

export interface ListTaskInstancesInput {
  readonly taskId?: string;
  readonly version?: number;
  readonly status?: TaskInstanceStatus;
  // updated window [from, to)
  readonly from?: number;
  readonly to?: number;
}

export interface ListTaskInstancesOutput {
  readonly taskInstances: TaskInstance[];
}

export interface AddTaskEventInput {
  readonly taskInstanceId: string;
  readonly source: TaskEventSource;
  readonly timestamp: number;
  readonly level: TaskEventLevel;
  readonly format: TaskEventFormat;
  readonly payload: any;
}

export interface AddTaskEventOutput {}

export interface ListTaskEventsInput {
  readonly taskInstanceId: string;
}

export interface ListTaskEventsOutput {
  readonly taskEvents: TaskEvent[];
}

export interface UpdateTaskInstanceStatusInput {
  readonly taskInstanceId: string;
  readonly status: TaskInstanceStatus;
}

export interface UpdateTaskInstanceStatusOutput {}

export interface SetTaskInstancePidInput {
  readonly taskInstanceId: string;
  readonly pid: number;
}

export interface SetTaskInstancePidOutput {}
/**
 * Manage task store, and provide efficient query implmementation.
 */
export interface TaskAccessor {
  init(): Promise<void>;
  terminate(): Promise<void>;
  createTask(input: CreateTaskInput): Promise<CreateTaskOutput>;
  updateTask(input: UpdateTaskInput): Promise<UpdateTaskOutput>;
  deleteTask(input: DeleteTaskInput): Promise<DeleteTaskOutput>;
  getTask(input: GetTaskInput): Promise<GetTaskOutput>;
  listLatestTasks(input: ListLatestTasksInput): Promise<ListLatestTasksOutput>;
  listHealthChecks(input: ListHealthChecksInput): Promise<ListHealthChecksOutput>;

  getTaskDynamics(input: GetTaskDynamicsInput): Promise<GetTaskDynamicsOutput>;
  resetTaskActive(input: ResetTaskActiveInput): Promise<ResetTaskActiveOutput>;
  resetTaskTargetAgents(input: ResetTaskTargetAgentsInput): Promise<ResetTaskTargetAgentsOutput>;

  createTaskInstance(input: CreateTaskInstanceInput): Promise<CreateTaskInstanceOutput>;
  getTaskInstance(input: GetTaskInstanceInput): Promise<GetTaskInstanceOutput>;
  listTaskInstances(input: ListTaskInstancesInput): Promise<ListTaskInstancesOutput>;
  updateTaskInstanceStatus(input: UpdateTaskInstanceStatusInput): Promise<UpdateTaskInstanceStatusOutput>;
  setTaskInstancPid(input: SetTaskInstancePidInput): Promise<SetTaskInstancePidOutput>;
  addTaskEvent(input: AddTaskEventInput): Promise<AddTaskEventOutput>;
  listTaskEvents(input: ListTaskEventsInput): Promise<ListTaskEventsOutput>;
}

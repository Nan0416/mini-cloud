import {
  CreateTaskRequest,
  ListHealthChecksRequest,
  ListTaskInstancesRequest,
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

export interface CreateTaskInstanceRequest {
  readonly taskId: string;
  readonly taskVersion: number;
}

export interface CreateTaskInstantResponse {
  readonly taskInstanceId: string;
}

export interface UpdateTaskInstanceStatusRequest {
  readonly taskInstanceId: string;
  readonly status: TaskInstanceStatus;
}

export interface NewTaskEventRequest {
  readonly instanceId: string;
  readonly source: TaskEventSource;
  readonly timestamp: number;
  readonly level: TaskEventLevel;
  readonly format: TaskEventFormat;
  readonly payload: any;
}

/**
 * Manage task store, and provide efficient query implmementation.
 */
export interface TaskFacade {
  init(): Promise<void>;
  terminate(): Promise<void>;
  createTask(request: CreateTaskRequest): Promise<TaskIdentifier>;
  updateTask(request: UpdateTaskRequest): Promise<TaskIdentifier>;
  deleteTask(taskId: string): Promise<void>;
  getTask(taskId: string, version?: number): Promise<Task>;
  listLatestTasks(): Promise<Task[]>;
  getTaskDynamics(taskId: string): Promise<TaskDynamics>;
  resetTaskActive(taskId: string, active: boolean): Promise<void>;
  resetTaskTargetAgents(taskId: string, targetAgentIds: string[]): Promise<void>;
  createTaskInstance(taskId: string, version: number, agentId: string): Promise<string>;
  getTaskInstance(instanceId: string): Promise<TaskInstance>;
  listTaskInstances(request: ListTaskInstancesRequest): Promise<TaskInstance[]>;
  listHealthChecks(request: ListHealthChecksRequest): Promise<TaskIdentifierWithHealthCheck[]>;
  updateTaskInstanceStatus(taskInstanceId: string, status: TaskInstanceStatus): Promise<void>;
  setTaskInstancPid(taskInstanceId: string, pid: number): Promise<void>;
  addTaskEvent(request: NewTaskEventRequest): Promise<void>;
  listTaskEvents(taskInstanceId: string): Promise<TaskEvent[]>;
}

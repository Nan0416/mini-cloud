import { Task, TaskDynamics, TaskEvent, TaskInstance, TaskInstanceStatus } from '../../models';
import { InternalLatestTaskId, InternalTask, InternalTaskEvent, InternalTaskInstance } from './internal-models';

export interface ListTaskInstancesInput {
  readonly taskId?: string;
  readonly version?: number;
  readonly status?: string;
  readonly from?: number;
  readonly to?: number;
}

export interface TaskDao {
  /**
   * has a new version.
   * @param internalTask
   */
  createTask(internalTask: InternalTask): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  getTask(taskId: string, version: number): Promise<Task | undefined>;
  upsertTaskLatestVersion(taskId: string, version: number): Promise<void>;
  deleteTaskLatestVersion(taskId: string): Promise<void>;
  getTaskLatestVersion(taskId: string): Promise<number | undefined>;
  listLatestTaskVersions(): Promise<InternalLatestTaskId[]>;
  getTaskDynamics(taskId: string): Promise<TaskDynamics | undefined>;
  upsertTaskDynamics(taskDynamics: TaskDynamics): Promise<void>;
  deleteTaskDynamics(taskId: string): Promise<void>;
  createTaskInstance(internalInstance: InternalTaskInstance): Promise<void>;
  getTaskInstance(instanceId: string): Promise<TaskInstance | undefined>;
  listTaskInstances(input: ListTaskInstancesInput): Promise<TaskInstance[]>;
  getTaskInstanceStatus(taskInstanceId: string): Promise<TaskInstanceStatus | undefined>;
  updateTaskInstanceStatus(taskInstanceId: string, status: string): Promise<void>;
  setTaskInstancePid(taskInstanceId: string, pid: number): Promise<void>;
  addTaskEvent(event: InternalTaskEvent): Promise<void>;
  listTaskEvents(taskInstanceId: string): Promise<TaskEvent[]>;
}

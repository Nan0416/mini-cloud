import { TaskInstance, TaskInstanceStatus } from '@mini-cloud/shared';

export interface CreateTaskInstanceInput {
  readonly instanceId: string;
  readonly taskId: string;
  readonly taskVersion: number;
  readonly agentId: string;
  readonly status: TaskInstanceStatus;
}

export interface ListTaskInstancesInput {
  readonly taskId?: string;
  readonly version?: number;
  readonly agentId?: string;
  readonly status?: TaskInstanceStatus;
  /** Last-updated window, epoch ms, half-open `[from, to)`. */
  readonly from?: number;
  readonly to?: number;
  readonly limit?: number;
}

/** What a guarded status write actually did. */
export interface UpdateStatusOutput {
  /** False when the instance no longer exists. */
  readonly found: boolean;
  /**
   * False when the update was rejected because the stored status already ranks
   * higher — a stale report arriving after a newer one.
   */
  readonly applied: boolean;
  readonly currentStatus?: TaskInstanceStatus;
}

export interface TaskInstanceDao {
  createInstance(input: CreateTaskInstanceInput): Promise<void>;

  getInstance(instanceId: string): Promise<TaskInstance | null>;

  listInstances(input: ListTaskInstancesInput): Promise<ReadonlyArray<TaskInstance>>;

  /**
   * Moves the instance to `status` only if that status ranks at or above the stored
   * one. The guard lives in the UPDATE's WHERE clause, so concurrent reports from
   * the same agent cannot interleave a read and a write.
   */
  updateStatus(instanceId: string, status: TaskInstanceStatus): Promise<UpdateStatusOutput>;

  setPid(instanceId: string, pid: number): Promise<boolean>;

  /** Instances stuck in `status` since before `olderThan`, for timeout sweeps. */
  listStaleInstances(status: TaskInstanceStatus, olderThan: number): Promise<ReadonlyArray<TaskInstance>>;

  /** Deletes instances (and, by cascade, their events) last updated before `before`. */
  deleteInstancesUpdatedBefore(before: number): Promise<number>;
}

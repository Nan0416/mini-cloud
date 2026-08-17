import { TaskInstance, TaskInstanceStatus } from '@mini-cloud/shared';

export interface CreateInstanceInput {
  readonly instanceId: string;
  readonly taskId: string;
  readonly taskVersion: number;
  readonly agentId: string;
  readonly status: TaskInstanceStatus;
}

export interface CreateInstanceOutput {}

export interface GetInstanceInput {
  readonly instanceId: string;
}

export interface GetInstanceOutput {
  readonly instance: TaskInstance | null;
}

export interface ListInstancesInput {
  readonly taskId?: string;
  readonly version?: number;
  readonly agentId?: string;
  readonly status?: TaskInstanceStatus;
  /** Last-updated window, epoch ms, half-open `[from, to)`. */
  readonly from?: number;
  readonly to?: number;
  readonly limit?: number;
}

export interface ListInstancesOutput {
  readonly instances: ReadonlyArray<TaskInstance>;
}

export interface UpdateStatusInput {
  readonly instanceId: string;
  readonly status: TaskInstanceStatus;
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

export interface SetPidInput {
  readonly instanceId: string;
  readonly pid: number;
}

export interface SetPidOutput {
  /** False when the instance no longer exists. */
  readonly found: boolean;
}

export interface ListStaleInstancesInput {
  readonly status: TaskInstanceStatus;
  readonly olderThan: number;
}

export interface ListStaleInstancesOutput {
  readonly instances: ReadonlyArray<TaskInstance>;
}

export interface DeleteInstancesUpdatedBeforeInput {
  readonly before: number;
}

export interface DeleteInstancesUpdatedBeforeOutput {
  readonly deletedCount: number;
}

export interface TaskInstanceDao {
  createInstance(input: CreateInstanceInput): Promise<CreateInstanceOutput>;

  getInstance(input: GetInstanceInput): Promise<GetInstanceOutput>;

  listInstances(input: ListInstancesInput): Promise<ListInstancesOutput>;

  /**
   * Moves the instance to `status` only if that status ranks at or above the stored
   * one. The guard lives in the UPDATE's WHERE clause, so concurrent reports from
   * the same agent cannot interleave a read and a write.
   */
  updateStatus(input: UpdateStatusInput): Promise<UpdateStatusOutput>;

  setPid(input: SetPidInput): Promise<SetPidOutput>;

  /** Instances stuck in `status` since before `olderThan`, for timeout sweeps. */
  listStaleInstances(input: ListStaleInstancesInput): Promise<ListStaleInstancesOutput>;

  /** Deletes instances (and, by cascade, their events) last updated before `before`. */
  deleteInstancesUpdatedBefore(input: DeleteInstancesUpdatedBeforeInput): Promise<DeleteInstancesUpdatedBeforeOutput>;
}

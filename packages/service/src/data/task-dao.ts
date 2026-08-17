import { EnvironmentVariables, HealthCheck, Job, Task, TaskIdentifier, TaskIdentifierWithHealthCheck, TaskType } from '@mini-cloud/shared';

/**
 * Every DAO method takes one Input and returns one Output, even when the payload is
 * empty — the same contract the service layer keeps with Request/Response. `{}` is
 * the point: it names the operation's shape and gives it somewhere to grow, so a
 * query gaining a filter or returning a second value is not a signature change for
 * every caller.
 *
 * Inputs stay flat and match the columns rather than the API shape. Outputs wrap the
 * shared domain model rather than replacing it: `Task` is the common vocabulary
 * across service, agent, client and CLI, and giving every DAO a private copy of it
 * would add indirection without decoupling anything.
 */
export interface CreateTaskVersionInput {
  readonly taskId: string;
  readonly version: number;
  readonly name: string;
  readonly description?: string;
  readonly type: TaskType;
  readonly cmd: string;
  readonly cwd: string;
  readonly arguments?: ReadonlyArray<string>;
  readonly env?: EnvironmentVariables;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly healthCheck?: HealthCheck;
  readonly durationMs?: number;
  readonly firstLaunchAt?: number;
}

export interface CreateTaskVersionOutput {}

export interface GetTaskVersionInput {
  readonly taskId: string;
  readonly version: number;
}

export interface GetTaskVersionOutput {
  readonly task: Task | null;
}

export interface GetLatestTaskInput {
  readonly taskId: string;
}

export interface GetLatestTaskOutput {
  readonly task: Task | null;
}

export interface GetLatestVersionNumberInput {
  readonly taskId: string;
}

export interface GetLatestVersionNumberOutput {
  /** Null when the task has no versions, i.e. it does not exist. */
  readonly version: number | null;
}

export interface ListLatestTasksInput {}

export interface ListLatestTasksOutput {
  readonly tasks: ReadonlyArray<Task>;
}

export interface DeleteTaskInput {
  readonly taskId: string;
}

export interface DeleteTaskOutput {}

export interface ListHealthChecksInput {
  readonly identifiers: ReadonlyArray<TaskIdentifier>;
}

export interface ListHealthChecksOutput {
  readonly healthChecks: ReadonlyArray<TaskIdentifierWithHealthCheck>;
}

/** A job the scheduler may auto-launch, paired with the agents it targets. */
export interface ScheduledJob {
  readonly job: Job;
  readonly targetAgentIds: ReadonlyArray<string>;
}

export interface ListScheduledJobsInput {}

export interface ListScheduledJobsOutput {
  readonly scheduledJobs: ReadonlyArray<ScheduledJob>;
}

export interface TaskDao {
  /** Inserts a new immutable version and repoints the head to it, in one transaction. */
  createTaskVersion(input: CreateTaskVersionInput): Promise<CreateTaskVersionOutput>;

  getTaskVersion(input: GetTaskVersionInput): Promise<GetTaskVersionOutput>;

  getLatestTask(input: GetLatestTaskInput): Promise<GetLatestTaskOutput>;

  getLatestVersionNumber(input: GetLatestVersionNumberInput): Promise<GetLatestVersionNumberOutput>;

  listLatestTasks(input: ListLatestTasksInput): Promise<ListLatestTasksOutput>;

  /** Removes every version of the task along with its head and dynamics rows. */
  deleteTask(input: DeleteTaskInput): Promise<DeleteTaskOutput>;

  /** Health checks for a set of exact task versions, skipping those without one. */
  listHealthChecks(input: ListHealthChecksInput): Promise<ListHealthChecksOutput>;

  /**
   * Every active, scheduled job at its head version, with its target agents.
   *
   * The scheduler runs this once per tick, so it joins tasks to dynamics in the
   * database rather than listing tasks and then fetching dynamics per task.
   */
  listScheduledJobs(input: ListScheduledJobsInput): Promise<ListScheduledJobsOutput>;
}

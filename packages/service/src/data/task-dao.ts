import { EnvironmentVariables, HealthCheck, Job, Task, TaskIdentifier, TaskIdentifierWithHealthCheck, TaskType } from '@mini-cloud/shared';

/**
 * DAO input types are defined per-operation and stay flat, matching the columns
 * rather than the API shape. Reads return the shared domain model: `Task` is the
 * common vocabulary across service, agent, client and CLI, and giving every DAO a
 * private copy of it would add indirection without decoupling anything.
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

/** A job the scheduler may auto-launch, paired with the agents it targets. */
export interface ScheduledJob {
  readonly job: Job;
  readonly targetAgentIds: ReadonlyArray<string>;
}

export interface TaskDao {
  /** Inserts a new immutable version and repoints the head to it, in one transaction. */
  createTaskVersion(input: CreateTaskVersionInput): Promise<void>;

  getTaskVersion(taskId: string, version: number): Promise<Task | null>;

  getLatestTask(taskId: string): Promise<Task | null>;

  getLatestVersionNumber(taskId: string): Promise<number | null>;

  listLatestTasks(): Promise<ReadonlyArray<Task>>;

  /** Removes every version of the task along with its head and dynamics rows. */
  deleteTask(taskId: string): Promise<void>;

  /** Health checks for a set of exact task versions, skipping those without one. */
  listHealthChecks(identifiers: ReadonlyArray<TaskIdentifier>): Promise<ReadonlyArray<TaskIdentifierWithHealthCheck>>;

  /**
   * Every active, scheduled job at its head version, with its target agents.
   *
   * The scheduler runs this once per tick, so it joins tasks to dynamics in the
   * database rather than listing tasks and then fetching dynamics per task.
   */
  listScheduledJobs(): Promise<ReadonlyArray<ScheduledJob>>;
}

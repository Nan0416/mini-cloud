import { EnvironmentVariables } from './common';

export type TaskType = 'job' | 'service';
export const TASK_TYPES: ReadonlyArray<TaskType> = ['job', 'service'];

/**
 * Tasks are immutable and versioned: every update writes a new version rather than
 * mutating the existing row, so a running instance always resolves the exact
 * definition it was launched from.
 */
export interface BaseTask {
  readonly taskId: string;
  readonly version: number;
  readonly createdAt: number;
  readonly lastUpdatedAt: number;

  readonly name: string;
  readonly description?: string;

  readonly type: TaskType;
  /** Executable or shell command. Supports `${NAME}` replacement variables. */
  readonly cmd: string;
  /** Working directory for the spawned process. Supports `${NAME}` replacement. */
  readonly cwd: string;
  readonly arguments?: ReadonlyArray<string>;
  readonly env?: EnvironmentVariables;
  /** File path to append stdout to. Omit to discard. */
  readonly stdout?: string;
  /** File path to append stderr to. Omit to discard. */
  readonly stderr?: string;
}

/** The agent polls an HTTP endpoint the task exposes. */
export interface PingHealthCheck {
  readonly type: 'ping';
  /** Full URL to poll, e.g. `http://127.0.0.1:8080/healthz`. */
  readonly url: string;
  readonly periodInMs?: number;
}

/** The task pushes a heartbeat to the agent using `@mini-cloud/reporter`. */
export interface PassiveHealthCheck {
  readonly type: 'passive';
  readonly periodInMs?: number;
}

export type HealthCheck = PingHealthCheck | PassiveHealthCheck;

/** A long-running process. Launched on demand and kept alive. */
export interface Service extends BaseTask {
  readonly type: 'service';
  readonly healthCheck?: HealthCheck;
}

/**
 * A process expected to run to completion. When `firstLaunchAt` and `duration` are
 * both set the scheduler relaunches it every `duration` ms from `firstLaunchAt`.
 */
export interface Job extends BaseTask {
  readonly type: 'job';
  /** Interval between launches, in ms. Omit for a manual-only job. */
  readonly duration?: number;
  /** Epoch ms of the first scheduled launch. Omit for a manual-only job. */
  readonly firstLaunchAt?: number;
}

export type Task = Job | Service;

/**
 * Mutable per-task state kept out of `Task` so that toggling a schedule or
 * retargeting agents does not create a new task version.
 */
export interface TaskDynamics {
  readonly taskId: string;
  /** Whether the scheduler may launch this task automatically. */
  readonly active: boolean;
  /** Agents the scheduler launches this task on. */
  readonly targetAgentIds: ReadonlyArray<string>;
}

export interface TaskIdentifier {
  readonly taskId: string;
  readonly version: number;
}

export interface TaskIdentifierWithHealthCheck extends TaskIdentifier {
  readonly healthCheck: HealthCheck;
}

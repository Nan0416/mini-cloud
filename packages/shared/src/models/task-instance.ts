/**
 * One launch of one task version on one agent.
 *
 * The status vocabulary deliberately distinguishes *where* a launch broke down:
 * `initiation_failed` means the service never reached the agent, `failed_to_launch`
 * means the agent could not spawn the process, and `start_timeout` means the process
 * spawned but never reported itself running.
 */
export type TaskInstanceStatus =
  | 'init' // row created, nothing dispatched yet
  | 'initiated' // service dispatched the launch command to the agent
  | 'initiation_failed' // agent was offline, nothing was dispatched
  | 'launching_timeout' // agent never acknowledged the launch command
  | 'launched' // agent spawned the process
  | 'failed_to_launch' // agent could not spawn the process
  | 'start_timeout' // process spawned but never reported a pid
  | 'running'
  | 'health_check_failure' // running but failing health checks; may recover
  | 'termination_initiated' // service dispatched the terminate command
  | 'termination_failed' // service could not dispatch the terminate command
  | 'terminating' // agent sent SIGINT
  | 'agent_termination_failed' // agent's kill(2) failed, e.g. permissions
  | 'terminated' // process confirmed gone
  | 'exit_success' // process exited 0
  | 'exit_failure'; // process exited non-zero

export const TASK_INSTANCE_STATUSES: ReadonlyArray<TaskInstanceStatus> = [
  'init',
  'initiated',
  'initiation_failed',
  'launching_timeout',
  'launched',
  'failed_to_launch',
  'start_timeout',
  'running',
  'health_check_failure',
  'termination_initiated',
  'termination_failed',
  'terminating',
  'agent_termination_failed',
  'terminated',
  'exit_success',
  'exit_failure',
];

/**
 * Rank of each status in the instance lifecycle.
 *
 * Status reports arrive over the network and can be reordered — an agent's
 * `terminated` can land before its own `terminating`. Writers compare ranks and
 * ignore any update that would move an instance backwards, so a terminal status is
 * never overwritten by a stale in-flight one. Equal ranks are allowed through, which
 * is what lets `running` and `health_check_failure` flip back and forth.
 */
export const TASK_INSTANCE_STATUS_RANK: Readonly<Record<TaskInstanceStatus, number>> = {
  init: 0,
  initiated: 100,
  initiation_failed: 100,
  launching_timeout: 199,
  launched: 200,
  failed_to_launch: 200,
  start_timeout: 201,
  running: 500,
  health_check_failure: 500,
  termination_initiated: 600,
  termination_failed: 600,
  terminating: 700,
  agent_termination_failed: 700,
  terminated: 999,
  exit_success: 999,
  exit_failure: 999,
};

/** Statuses an agent is allowed to report. A subset of the full lifecycle. */
export type AgentReportedStatus = Extract<
  TaskInstanceStatus,
  'launched' | 'failed_to_launch' | 'running' | 'terminating' | 'agent_termination_failed' | 'terminated' | 'exit_success' | 'exit_failure' | 'health_check_failure'
>;

export const AGENT_REPORTED_STATUSES: ReadonlyArray<AgentReportedStatus> = [
  'launched',
  'failed_to_launch',
  'running',
  'terminating',
  'agent_termination_failed',
  'terminated',
  'exit_success',
  'exit_failure',
  'health_check_failure',
];

/** Statuses from which a termination request is meaningful. */
export const TERMINATION_PERMITTED_STATUSES: ReadonlyArray<TaskInstanceStatus> = [
  'initiated',
  'launching_timeout',
  'launched',
  'failed_to_launch',
  'start_timeout',
  'running',
  'health_check_failure',
  'termination_initiated',
  'termination_failed',
  'terminating',
  'agent_termination_failed',
];

/** Statuses meaning the process is gone and will not report again. */
export const TERMINAL_STATUSES: ReadonlyArray<TaskInstanceStatus> = ['terminated', 'exit_success', 'exit_failure'];

export interface TaskInstance {
  readonly instanceId: string;
  readonly taskId: string;
  readonly taskVersion: number;
  readonly agentId: string;
  /** OS process id, known only once the task reports it. */
  readonly pid?: number;
  readonly status: TaskInstanceStatus;
  readonly createdAt: number;
  readonly lastUpdatedAt: number;
}

export type TaskEventLevel = 'success' | 'warning' | 'error';
export const TASK_EVENT_LEVELS: ReadonlyArray<TaskEventLevel> = ['success', 'warning', 'error'];

export type TaskEventSource = 'service' | 'agent' | 'task';
export const TASK_EVENT_SOURCES: ReadonlyArray<TaskEventSource> = ['service', 'agent', 'task'];

/** Sources an external caller may claim. `service` is reserved for the service itself. */
export const EXTERNAL_TASK_EVENT_SOURCES: ReadonlyArray<TaskEventSource> = ['agent', 'task'];

/**
 * An audit-log entry attached to an instance: status transitions, agent notes, task logs.
 *
 * `payload` is stored as JSONB and read back parsed, so a string payload arrives as a
 * string and an object as an object. There is no separate format discriminator —
 * JSON already carries that distinction.
 */
export interface TaskEvent {
  readonly eventId: string;
  readonly instanceId: string;
  readonly source: TaskEventSource;
  readonly timestamp: number;
  readonly level: TaskEventLevel;
  readonly payload: unknown;
}

export interface EnvironmentVariables {
  readonly [key: string]: string;
}

export interface ReplacementVariables {
  readonly [key: string]: string;
}

export type TaskType = 'job' | 'service';

export interface BaseTask {
  readonly taskId: string;
  readonly version: number;
  readonly createdAt: number;
  readonly lastUpdatedAt: number;
  readonly name: string;
  readonly description?: string;

  readonly type: TaskType;
  readonly cmd: string; // support ${keyword} replacement
  readonly cwd: string;
  readonly arguments?: string[];
  readonly env?: EnvironmentVariables;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface Job extends BaseTask {
  readonly type: 'job';

  readonly duration?: number;
  readonly firstLaunchAt?: number;
}

interface BaseHealthCheck {
  readonly type: 'ping' | 'passive';
}

export interface PingHealthCheck extends BaseHealthCheck {
  readonly type: 'ping';
  readonly domain: string;
  // default /ping
  readonly path?: string;
  readonly periodInMs?: number;
}

export interface PassiveHealthCheck extends BaseHealthCheck {
  readonly type: 'passive';
  readonly periodInMs?: number;
}

export type HealthCheck = PingHealthCheck | PassiveHealthCheck;

export interface Service extends BaseTask {
  readonly type: 'service';
  readonly healthCheck?: HealthCheck;
}

export type TaskInstanceStatus =
  | 'init' // before anything
  | 'initiated' // task service successfully broadcasted the launching request.
  | 'initiation_failed'
  | 'launching_timeout' // task service doesn't receive the "launched" status after certain time.
  | 'launched' // task agent successfully launched task
  | 'failed_to_launch'
  | 'start_timeout' // task service doesn't receive the "running" status after certain time
  | 'running'
  | 'termination_initiated' // after task service broadcast termination message.
  | 'termination_failed'
  | 'terminating' // after task agent send SIGINT signal,
  | 'agent_termination_failed' // process.kill failed, e.g. permission issue.
  | 'terminated' // task reported termination.
  | 'exit(0)' // job exit normally.
  | 'health_check_failure'
  | 'exit(1)'; // job or service exit abnormally

export const TASK_INSTANCE_STATUSES: ReadonlyArray<TaskInstanceStatus> = [
  'init',
  'initiated',
  'initiation_failed',
  'launching_timeout',
  'launched',
  'failed_to_launch',
  'start_timeout',
  'running',
  'termination_initiated',
  'termination_failed',
  'terminating',
  'agent_termination_failed',
  'terminated',
  'exit(0)',
  'health_check_failure',
  'exit(1)',
];

export interface TaskInstance {
  readonly taskId: string;
  readonly taskVersion: number;
  readonly instanceId: string;
  readonly agentId: string;
  readonly pid?: number;
  readonly status: TaskInstanceStatus;
  readonly createdAt: number;
  readonly lastUpdatedAt: number;
}

export type TaskEventLevel = 'success' | 'warning' | 'error';

export const TASK_EVENT_LEVELS: ReadonlyArray<TaskEventLevel> = ['success', 'warning', 'error'];

export type TaskEventFormat = 'string' | 'json';

export type TaskEventSource = 'task-service' | 'task-agent' | 'task-instance';

export interface TaskEvent {
  readonly instanceId: string;
  readonly source: TaskEventSource;
  readonly eventId: string;
  readonly timestamp: number;
  readonly level: TaskEventLevel;
  readonly format: TaskEventFormat;
  readonly payload: any;
}

/**
 * put properties to task dynamics if it doesn't make sense to
 * create a new version due to this property change.
 */
export interface TaskDynamics {
  readonly taskId: string;
  readonly active: boolean;
  readonly targetAgentIds: string[];
}

export type Task = Job | Service;

export type AgentStatus = 'online' | 'offline';

/**
 * The host is equivalent to a host agent instance. And a physical host can run mutlitple host agents, so a physical may be used as multiple hosts.
 */
export interface TaskAgent {
  readonly identifier: string; // unique;
  readonly status: AgentStatus;
  readonly name: string;
}

// a subset of task status
export type AgentSideTaskStatus =
  | 'launched'
  | 'failed_to_launch'
  | 'running'
  | 'terminating' // after task agent send SIGINT signal,
  | 'agent_termination_failed' // process.kill failed, e.g. permission issue.
  | 'terminated' // service terminated
  | 'exit(0)' // job exit normally.
  | 'exit(1)'
  | 'health_check_failure';

import { TaskInstanceStatus } from '../../models';

/**
 * Task instance status state machine
 *
 * Based on the state machine, an higher order status can override a lower order status,
 * but it will ignore the case when a lower order status wants to override a higher order status
 *
 * For example, the task service may receive "terminated" status before "terminating" due to various factors, such as network issue.
 * And the later "terminating" status change will be ignored since the status is already terminated, which has a higher order.
 *
 */
export const TASK_INSTANCE_STATUS_TO_ORDER: Readonly<Record<TaskInstanceStatus, number>> = {
  init: 0,
  initiated: 100,
  initiation_failed: 100,
  launching_timeout: 199,
  launched: 200,
  failed_to_launch: 200,
  start_timeout: 201,
  running: 500,
  health_check_failure: 500, // a running task can become health check failed, and a health check failed task may back online.
  termination_initiated: 600,
  termination_failed: 600,
  terminating: 700,
  agent_termination_failed: 700,
  terminated: 999,
  'exit(0)': 999,
  'exit(1)': 999,
};

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

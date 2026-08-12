import {
  AgentStatus,
  InternalServiceError,
  TASK_EVENT_FORMATS,
  TASK_EVENT_LEVELS,
  TASK_EVENT_SOURCES,
  TASK_INSTANCE_STATUSES,
  TaskEventFormat,
  TaskEventLevel,
  TaskEventSource,
  TaskInstanceStatus,
} from '@mini-cloud/shared';

/**
 * Narrows the `TEXT` columns that hold union types.
 *
 * The table has CHECK constraints, so a mismatch here means the schema and the
 * TypeScript unions have drifted apart — an internal bug, not bad user input, hence
 * the 500 rather than a 400.
 */
function narrow<T extends string>(value: string, allowed: ReadonlyArray<T>, column: string, rowId: string): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new InternalServiceError(`Row ${rowId} has unrecognised ${column} "${value}".`);
  }
  return match;
}

export function toTaskInstanceStatus(value: string, instanceId: string): TaskInstanceStatus {
  return narrow(value, TASK_INSTANCE_STATUSES, 'status', instanceId);
}

export function toTaskEventSource(value: string, eventId: string): TaskEventSource {
  return narrow(value, TASK_EVENT_SOURCES, 'source', eventId);
}

export function toTaskEventLevel(value: string, eventId: string): TaskEventLevel {
  return narrow(value, TASK_EVENT_LEVELS, 'level', eventId);
}

export function toTaskEventFormat(value: string, eventId: string): TaskEventFormat {
  return narrow(value, TASK_EVENT_FORMATS, 'format', eventId);
}

export function toAgentStatus(value: string, agentId: string): AgentStatus {
  return narrow(value, ['online', 'offline'], 'status', agentId);
}

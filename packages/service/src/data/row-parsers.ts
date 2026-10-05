import {
  AgentStatus,
  InternalServiceError,
  METRIC_STATISTICS,
  METRIC_UNITS,
  MONITOR_COMPARISONS,
  MONITOR_SEVERITIES,
  MONITOR_STATES,
  MetricStatistic,
  MetricUnit,
  MonitorComparison,
  MonitorSeverity,
  MonitorState,
  NOTIFIER_TYPES,
  NotifierType,
  TREAT_MISSING_DATA,
  TASK_EVENT_LEVELS,
  TASK_EVENT_SOURCES,
  TASK_INSTANCE_STATUSES,
  TaskEventLevel,
  TaskEventSource,
  TaskInstanceStatus,
  TreatMissingData,
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

export function toAgentStatus(value: string, agentId: string): AgentStatus {
  return narrow(value, ['online', 'offline'], 'status', agentId);
}

export function toMetricUnit(value: string): MetricUnit {
  return narrow(value, METRIC_UNITS, 'unit', value);
}

export function toMetricStatistic(value: string, rowId: string): MetricStatistic {
  return narrow(value, METRIC_STATISTICS, 'statistic', rowId);
}

export function toMonitorComparison(value: string, rowId: string): MonitorComparison {
  return narrow(value, MONITOR_COMPARISONS, 'comparison', rowId);
}

export function toTreatMissingData(value: string, rowId: string): TreatMissingData {
  return narrow(value, TREAT_MISSING_DATA, 'treat_missing_data', rowId);
}

export function toMonitorState(value: string, rowId: string): MonitorState {
  return narrow(value, MONITOR_STATES, 'state', rowId);
}

export function toMonitorSeverity(value: number, monitorName: string): MonitorSeverity {
  const match = MONITOR_SEVERITIES.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new InternalServiceError(`Row ${monitorName} has unrecognised severity ${value}.`);
  }
  return match;
}

export function toNotifierType(value: string, notifierId: string): NotifierType {
  return narrow(value, NOTIFIER_TYPES, 'type', notifierId);
}

import {
  AGENT_REPORTED_STATUSES,
  CreateTaskRequest,
  EXTERNAL_TASK_EVENT_SOURCES,
  HealthCheck,
  HeartbeatRequest,
  InvalidRequestError,
  LaunchTaskRequest,
  ListHealthChecksRequest,
  ListTaskInstancesRequest,
  PublishRequest,
  ReportInstancePidRequest,
  ReportInstanceStatusRequest,
  ReportTaskEventRequest,
  SetReplacementVariablesRequest,
  SetTaskActiveRequest,
  SetTaskTargetAgentsRequest,
  TASK_EVENT_LEVELS,
  TASK_INSTANCE_STATUSES,
  TASK_TYPES,
  UpdateTaskRequest,
  assertArray,
  assertBoolean,
  assertInteger,
  assertNonEmptyString,
  assertOneOf,
  assertOptionalInteger,
  assertOptionalString,
  assertOptionalStringArray,
  assertOptionalStringMap,
  assertRecord,
  assertString,
  assertStringArray,
  assertStringMap,
  parseOptionalIntegerParam,
} from '@mini-cloud/shared';

/** Minimum job interval. Below this the scheduler's tick resolution cannot keep up. */
const MINIMUM_JOB_DURATION_MS = 5_000;
const MINIMUM_HEALTH_CHECK_PERIOD_MS = 1_000;

function parseHealthCheck(value: unknown): HealthCheck {
  const record = assertRecord(value, 'healthCheck');
  const type = assertOneOf(record['type'], 'healthCheck.type', ['ping', 'passive']);
  const periodInMs = assertOptionalInteger(record['periodInMs'], 'healthCheck.periodInMs');
  if (periodInMs !== undefined && periodInMs < MINIMUM_HEALTH_CHECK_PERIOD_MS) {
    throw new InvalidRequestError(`healthCheck.periodInMs must be at least ${MINIMUM_HEALTH_CHECK_PERIOD_MS}`);
  }

  if (type === 'ping') {
    const url = assertNonEmptyString(record['url'], 'healthCheck.url');
    // Validated on the way in so a typo fails at task-creation time rather than
    // silently failing every probe once the task is running.
    try {
      new URL(url);
    } catch {
      throw new InvalidRequestError(`healthCheck.url must be an absolute URL (got "${url}")`);
    }
    return { type, url, periodInMs };
  }
  return { type, periodInMs };
}

interface CommonTaskFields {
  readonly name: string;
  readonly description?: string;
  readonly cmd: string;
  readonly cwd: string;
  readonly arguments?: string[];
  readonly env?: Record<string, string>;
  readonly stdout?: string;
  readonly stderr?: string;
}

function parseCommonTaskFields(record: Record<string, unknown>): CommonTaskFields {
  return {
    name: assertNonEmptyString(record['name'], 'name'),
    description: assertOptionalString(record['description'], 'description'),
    cmd: assertNonEmptyString(record['cmd'], 'cmd'),
    cwd: assertNonEmptyString(record['cwd'], 'cwd'),
    arguments: assertOptionalStringArray(record['arguments'], 'arguments'),
    env: assertOptionalStringMap(record['env'], 'env'),
    stdout: assertOptionalString(record['stdout'], 'stdout'),
    stderr: assertOptionalString(record['stderr'], 'stderr'),
  };
}

function parseJobFields(record: Record<string, unknown>): { duration?: number; firstLaunchAt?: number } {
  const duration = assertOptionalInteger(record['duration'], 'duration');
  if (duration !== undefined && duration < MINIMUM_JOB_DURATION_MS) {
    throw new InvalidRequestError(`duration must be at least ${MINIMUM_JOB_DURATION_MS}ms`);
  }
  const firstLaunchAt = assertOptionalInteger(record['firstLaunchAt'], 'firstLaunchAt');
  if (firstLaunchAt !== undefined && firstLaunchAt <= 0) {
    throw new InvalidRequestError('firstLaunchAt must be a positive epoch timestamp in milliseconds');
  }
  if (duration !== undefined && firstLaunchAt === undefined) {
    // Without an anchor there is nothing for the interval to repeat from.
    throw new InvalidRequestError('firstLaunchAt is required when duration is set');
  }
  return { duration, firstLaunchAt };
}

export function parseCreateTaskRequest(body: unknown): CreateTaskRequest {
  const record = assertRecord(body, 'body');
  const common = parseCommonTaskFields(record);
  const type = assertOneOf(record['type'], 'type', TASK_TYPES);

  if (type === 'job') {
    return { ...common, type, ...parseJobFields(record) };
  }
  return { ...common, type, healthCheck: record['healthCheck'] === undefined ? undefined : parseHealthCheck(record['healthCheck']) };
}

export function parseUpdateTaskRequest(body: unknown): UpdateTaskRequest {
  const record = assertRecord(body, 'body');
  const taskId = assertNonEmptyString(record['taskId'], 'taskId');
  const common = parseCommonTaskFields(record);
  const type = assertOneOf(record['type'], 'type', TASK_TYPES);

  if (type === 'job') {
    return { ...common, taskId, type, ...parseJobFields(record) };
  }
  return { ...common, taskId, type, healthCheck: record['healthCheck'] === undefined ? undefined : parseHealthCheck(record['healthCheck']) };
}

export function parseLaunchTaskRequest(body: unknown): LaunchTaskRequest {
  const record = assertRecord(body, 'body');
  return {
    taskId: assertNonEmptyString(record['taskId'], 'taskId'),
    targetAgentIds: assertOptionalStringArray(record['targetAgentIds'], 'targetAgentIds'),
    arguments: assertOptionalStringArray(record['arguments'], 'arguments'),
  };
}

export function parseSetTaskActiveRequest(body: unknown): SetTaskActiveRequest {
  const record = assertRecord(body, 'body');
  return { taskId: assertNonEmptyString(record['taskId'], 'taskId'), active: assertBoolean(record['active'], 'active') };
}

export function parseSetTaskTargetAgentsRequest(body: unknown): SetTaskTargetAgentsRequest {
  const record = assertRecord(body, 'body');
  return { taskId: assertNonEmptyString(record['taskId'], 'taskId'), targetAgentIds: assertStringArray(record['targetAgentIds'], 'targetAgentIds') };
}

export function parseSetReplacementVariablesRequest(body: unknown): SetReplacementVariablesRequest {
  const record = assertRecord(body, 'body');
  return { variables: assertStringMap(record['variables'], 'variables') };
}

export function parseListTaskInstancesQuery(query: unknown): ListTaskInstancesRequest {
  const record = assertRecord(query, 'query');
  const taskId = assertOptionalString(record['taskId'], 'taskId');
  const version = parseOptionalIntegerParam(record['version'], 'version');
  if (version !== undefined && taskId === undefined) {
    throw new InvalidRequestError('taskId is required when version is given');
  }

  const status = record['status'] === undefined ? undefined : assertOneOf(record['status'], 'status', TASK_INSTANCE_STATUSES);
  return {
    taskId,
    version,
    agentId: assertOptionalString(record['agentId'], 'agentId'),
    status,
    from: parseOptionalIntegerParam(record['from'], 'from'),
    to: parseOptionalIntegerParam(record['to'], 'to'),
    limit: parseOptionalIntegerParam(record['limit'], 'limit'),
  };
}

export function parseHeartbeatRequest(body: unknown): HeartbeatRequest {
  const record = assertRecord(body, 'body');
  return { agentId: assertNonEmptyString(record['agentId'], 'agentId'), name: assertNonEmptyString(record['name'], 'name') };
}

export function parseReportInstanceStatusRequest(body: unknown): ReportInstanceStatusRequest {
  const record = assertRecord(body, 'body');
  return {
    instanceId: assertNonEmptyString(record['instanceId'], 'instanceId'),
    // Agents may only report the subset of statuses they can actually observe; the
    // rest are the service's to assign.
    status: assertOneOf(record['status'], 'status', AGENT_REPORTED_STATUSES),
  };
}

export function parseReportInstancePidRequest(body: unknown): ReportInstancePidRequest {
  const record = assertRecord(body, 'body');
  const pid = assertInteger(record['pid'], 'pid');
  if (pid <= 0) {
    throw new InvalidRequestError('pid must be positive');
  }
  return { instanceId: assertNonEmptyString(record['instanceId'], 'instanceId'), pid };
}

export function parseReportTaskEventRequest(body: unknown): ReportTaskEventRequest {
  const record = assertRecord(body, 'body');
  const payload = record['payload'];
  if (payload === undefined) {
    throw new InvalidRequestError('payload is required');
  }

  return {
    instanceId: assertNonEmptyString(record['instanceId'], 'instanceId'),
    source: assertOneOf(record['source'], 'source', EXTERNAL_TASK_EVENT_SOURCES),
    timestamp: assertInteger(record['timestamp'], 'timestamp'),
    level: assertOneOf(record['level'], 'level', TASK_EVENT_LEVELS),
    // Any JSON value is acceptable; it is stored as JSONB and read back with its
    // type intact, so a string stays a string and an object stays an object.
    payload,
  };
}

export function parseListHealthChecksRequest(body: unknown): ListHealthChecksRequest {
  const record = assertRecord(body, 'body');
  const raw = assertArray(record['taskIdentifiers'], 'taskIdentifiers');
  return {
    taskIdentifiers: raw.map((entry, index) => {
      const identifier = assertRecord(entry, `taskIdentifiers[${index}]`);
      return {
        taskId: assertNonEmptyString(identifier['taskId'], `taskIdentifiers[${index}].taskId`),
        version: assertInteger(identifier['version'], `taskIdentifiers[${index}].version`),
      };
    }),
  };
}

export function parsePublishRequest(body: unknown): PublishRequest {
  const record = assertRecord(body, 'body');
  return { topic: assertNonEmptyString(record['topic'], 'topic'), payload: record['payload'] };
}

export function requireTaskIdParam(query: unknown): string {
  const record = assertRecord(query, 'query');
  return assertNonEmptyString(record['taskId'], 'taskId');
}

export function requireInstanceIdParam(query: unknown): string {
  const record = assertRecord(query, 'query');
  return assertNonEmptyString(record['instanceId'], 'instanceId');
}

export function optionalVersionParam(query: unknown): number | undefined {
  const record = assertRecord(query, 'query');
  return parseOptionalIntegerParam(record['version'], 'version');
}

export function optionalLimitParam(query: unknown): number | undefined {
  const record = assertRecord(query, 'query');
  return parseOptionalIntegerParam(record['limit'], 'limit');
}

export function requireStringField(body: unknown, field: string): string {
  const record = assertRecord(body, 'body');
  return assertNonEmptyString(record[field], field);
}

export { assertString };

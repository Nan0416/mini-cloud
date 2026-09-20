import {
  AGENT_REPORTED_STATUSES,
  BroadcastRequest,
  CreateTaskRequest,
  GetMetricDataRequest,
  EXTERNAL_TASK_EVENT_SOURCES,
  HealthCheck,
  HeartbeatRequest,
  InvalidRequestError,
  LaunchTaskRequest,
  ListAgentInstancesRequest,
  ListHealthChecksRequest,
  ListMetricDimensionsRequest,
  ListMetricNamesRequest,
  ListTaskInstancesRequest,
  METRIC_STATISTICS,
  METRIC_UNITS,
  MetricDatum,
  MetricDimensions,
  PutMetricDataRequest,
  ReportInstancePidRequest,
  ReportInstanceStatusRequest,
  ReportTaskEventRequest,
  SendToRequest,
  SetReplacementVariablesRequest,
  SetTaskActiveRequest,
  SetTaskTargetAgentsRequest,
  TASK_EVENT_LEVELS,
  TASK_INSTANCE_STATUSES,
  TASK_TYPES,
  UpdateTaskRequest,
  assertArray,
  assertBoolean,
  assertDefined,
  assertInteger,
  assertNonEmptyString,
  assertNumber,
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

/**
 * The agent plane's instance list, parsed from a body rather than a query string.
 *
 * Separate from `parseListTaskInstancesQuery` because it accepts less: an agent id and
 * optionally a status, and nothing else. The operator's version exists to answer
 * questions about the fleet's history; this one exists so a restarted agent can find
 * out what it is still supervising.
 */
export function parseListAgentInstancesRequest(body: unknown): ListAgentInstancesRequest {
  const record = assertRecord(body, 'body');
  return {
    agentId: assertNonEmptyString(record['agentId'], 'agentId'),
    status: record['status'] === undefined ? undefined : assertOneOf(record['status'], 'status', TASK_INSTANCE_STATUSES),
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
  return {
    instanceId: assertNonEmptyString(record['instanceId'], 'instanceId'),
    source: assertOneOf(record['source'], 'source', EXTERNAL_TASK_EVENT_SOURCES),
    timestamp: assertInteger(record['timestamp'], 'timestamp'),
    level: assertOneOf(record['level'], 'level', TASK_EVENT_LEVELS),
    // Any JSON value is acceptable; it is stored as JSONB and read back with its
    // type intact, so a string stays a string and an object stays an object.
    payload: assertDefined(record['payload'], 'payload'),
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

/**
 * The sender of a message is the connection it arrived on, never a field a caller
 * can set. HTTP publishers hold no connection, so they are anonymous — rejecting the
 * field rather than ignoring it stops a caller believing an attribution it did not
 * actually get.
 */
function rejectSenderId(record: Record<string, unknown>): void {
  if (record['senderId'] !== undefined) {
    throw new InvalidRequestError('senderId cannot be set by a publisher; HTTP messages are sent anonymously. Publish over a WebSocket to be attributed.');
  }
}

/** What both publish routes carry, whatever they are addressed to. */
interface PublishedMessage {
  readonly publishedAt: number;
  readonly payload: unknown;
}

function parsePublishedMessage(record: Record<string, unknown>): PublishedMessage {
  rejectSenderId(record);
  return {
    // Required, though the field is optional in the contract: `MiniCloudClient` fills
    // it in, so only a hand-rolled request can reach here without one.
    publishedAt: assertInteger(record['publishedAt'], 'publishedAt'),
    payload: assertDefined(record['payload'], 'payload'),
  };
}

export function parseBroadcastRequest(body: unknown): Required<BroadcastRequest> {
  const record = assertRecord(body, 'body');
  return { topic: assertNonEmptyString(record['topic'], 'topic'), ...parsePublishedMessage(record) };
}

export function parseSendToRequest(body: unknown): Required<SendToRequest> {
  const record = assertRecord(body, 'body');
  return { recipientId: assertNonEmptyString(record['recipientId'], 'recipientId'), ...parsePublishedMessage(record) };
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

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function parseMetricDatum(value: unknown, index: number): MetricDatum {
  const record = assertRecord(value, `data[${index}]`);
  const histogram = assertRecord(record['histogram'] ?? {}, `data[${index}].histogram`);
  const counts: Record<string, number> = {};
  for (const [bucket, count] of Object.entries(histogram)) {
    // Keys are stringified numbers; a key that is not one would silently become a
    // bucket nothing could ever read back.
    if (!Number.isFinite(Number(bucket))) {
      throw new InvalidRequestError(`data[${index}].histogram has a non-numeric key "${bucket}"`);
    }
    counts[bucket] = assertInteger(count, `data[${index}].histogram.${bucket}`);
  }

  return {
    namespace: assertNonEmptyString(record['namespace'], `data[${index}].namespace`),
    metricName: assertNonEmptyString(record['metricName'], `data[${index}].metricName`),
    dimensions: assertStringMap(record['dimensions'] ?? {}, `data[${index}].dimensions`),
    unit: assertOneOf(record['unit'], `data[${index}].unit`, METRIC_UNITS),
    bucketStart: assertInteger(record['bucketStart'], `data[${index}].bucketStart`),
    sampleCount: assertInteger(record['sampleCount'], `data[${index}].sampleCount`),
    sum: assertNumber(record['sum'], `data[${index}].sum`),
    min: assertNumber(record['min'], `data[${index}].min`),
    max: assertNumber(record['max'], `data[${index}].max`),
    histogram: counts,
  };
}

export function parsePutMetricDataRequest(body: unknown): PutMetricDataRequest {
  const record = assertRecord(body, 'body');
  return {
    agentId: assertNonEmptyString(record['agentId'], 'agentId'),
    // Without an id a retry cannot be told from new data, and the merge is additive.
    batchId: assertNonEmptyString(record['batchId'], 'batchId'),
    data: assertArray(record['data'], 'data').map((entry, index) => parseMetricDatum(entry, index)),
  };
}

export function parseListMetricNamesRequest(query: unknown): ListMetricNamesRequest {
  const record = assertRecord(query, 'query');
  return { namespace: assertNonEmptyString(record['namespace'], 'namespace') };
}

export function parseListMetricDimensionsRequest(query: unknown): ListMetricDimensionsRequest {
  const record = assertRecord(query, 'query');
  return {
    namespace: assertNonEmptyString(record['namespace'], 'namespace'),
    metricName: assertNonEmptyString(record['metricName'], 'metricName'),
  };
}

/**
 * Dimensions travel as repeated `dimension=Name:Value` parameters.
 *
 * The whole set is the series identity, so it is one parameter per dimension rather
 * than a nested object: a query string has no good way to express the latter, and a
 * partially parsed set would silently read a different series than the caller meant.
 */
function parseDimensionParams(value: unknown): MetricDimensions | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const entries = Array.isArray(value) ? value : [value];
  const dimensions: Record<string, string> = {};
  for (const [index, entry] of entries.entries()) {
    const pair = assertNonEmptyString(entry, `dimension[${index}]`);
    const separator = pair.indexOf(':');
    if (separator <= 0) {
      throw new InvalidRequestError(`dimension[${index}] must be "Name:Value", for example "Operation:Ingest"`);
    }
    dimensions[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return dimensions;
}

export function parseGetMetricDataRequest(query: unknown): GetMetricDataRequest {
  const record = assertRecord(query, 'query');
  const from = parseOptionalIntegerParam(record['from'], 'from');
  if (from === undefined) {
    throw new InvalidRequestError('from is required, as milliseconds since the epoch');
  }
  const periodMs = parseOptionalIntegerParam(record['periodMs'], 'periodMs') ?? 60_000;
  if (periodMs <= 0) {
    throw new InvalidRequestError('periodMs must be positive');
  }

  return {
    namespace: assertNonEmptyString(record['namespace'], 'namespace'),
    metricName: assertNonEmptyString(record['metricName'], 'metricName'),
    statistic: assertOneOf(record['statistic'] ?? 'avg', 'statistic', METRIC_STATISTICS),
    periodMs,
    from,
    to: parseOptionalIntegerParam(record['to'], 'to'),
    dimensions: parseDimensionParams(record['dimension']),
  };
}

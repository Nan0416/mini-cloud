import {
  AgentSideTaskStatus,
  CreateTaskRequest,
  DeleteTaskRequest,
  GetTaskDynamicsRequest,
  GetTaskInstanceRequest,
  GetTaskRequest,
  HealthCheck,
  InvalidRequestError,
  LaunchTaskRequest,
  ListHealthChecksRequest,
  ListRunningInstancesRequest,
  ListTaskEventsRequest,
  ListTaskInstancesRequest,
  ReportAgentStatusRequest,
  ReportTaskEventRequest,
  ReportTaskInstancePidRequest,
  ReportTaskInstanceStatusRequest,
  ResetReplacementVariablesRequest,
  ResetTaskActiveRequest,
  ResetTaskTargetAgentsRequest,
  TaskEventFormat,
  TaskEventLevel,
  TaskEventSource,
  TaskInstanceStatus,
  TerminateTaskAgentRequest,
  TerminateTaskInstanceRequest,
  UpdateTaskRequest,
} from '../models';
import lodash from 'lodash';

const EXTERNAL_TASK_EVENT_SOURCES: ReadonlyArray<TaskEventSource> = [
  'task-agent',
  'task-instance',
  // 'task-service'
];

const TASK_EVENT_LEVELS: ReadonlyArray<TaskEventLevel> = ['error', 'warning', 'success'];

const TASK_EVENT_FORMAT: ReadonlyArray<TaskEventFormat> = ['json', 'string'];

const TASK_INSTANCE_STATUSES: ReadonlyArray<TaskInstanceStatus> = [
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

const AGENT_SIDE_TASK_INSTANCE_STATUSES: ReadonlyArray<AgentSideTaskStatus> = [
  'launched',
  'failed_to_launch',
  'running',
  'terminating',
  'agent_termination_failed',
  'terminated',
  'health_check_failure',
  'exit(0)',
  'exit(1)',
];

export function assertReportTaskEventRequest(data: any): asserts data is ReportTaskEventRequest {
  assert(data !== undefined, 'invalid ReportTaskEventRequest');
  assert(typeof data.taskInstanceId === 'string', 'invalid instanceId in new task event');
  assert(EXTERNAL_TASK_EVENT_SOURCES.includes(data.source), 'invalid source in new task event');
  assert(typeof data.timestamp === 'number' && Math.round(data.timestamp) === data.timestamp && data.timestamp > 0, 'invalid timestamp in new task event');
  assert(TASK_EVENT_LEVELS.includes(data.level), 'invalid level in new task event');
  assert(TASK_EVENT_FORMAT.includes(data.format), 'invalid format in new task event');
  if (data.format === 'json') {
    assert(typeof data.payload === 'object', 'invalid payload in new task event');
  } else if (data.format === 'string') {
    assert(typeof data.payload === 'string', 'invalid payload in new task event');
  }
}

export function assertReportTaskInstancePidRequest(data: any): asserts data is ReportTaskInstancePidRequest {
  assert(data !== undefined, 'invalid ReportTaskInstancePidRequest');
  assert(typeof data.taskInstanceId === 'string', 'invalid taskInstanceId in set instance pid request');
  assert(typeof data.pid === 'number', 'invalid pid in set instance pid request');
}

export function assertReportTaskInstanceStatusRequest(data: any): asserts data is ReportTaskInstanceStatusRequest {
  assert(data !== undefined, 'invalid update instance status request');
  assert(typeof data.taskInstanceId === 'string', 'invalid taskInstanceId in update instance status request');
  assert(AGENT_SIDE_TASK_INSTANCE_STATUSES.includes(data.status), 'invalid status in set instance status request');
}

export function assertReportAgentStatusRequest(data: any): asserts data is ReportAgentStatusRequest {
  assert(data !== undefined, 'invalid update instance status request');
  assert(typeof data.agentId === 'string', 'invalid agentId in agent status request');
  assert(typeof data.name === 'string' || data.name === undefined, 'name status in agent status request');
}

export function assertCreateTaskRequest(data: CreateTaskRequest): asserts data is CreateTaskRequest {
  assert(data !== undefined, 'invalid create task request');
  assert(typeof data.name === 'string', 'invalid name in create task request');
  assert(typeof data.cmd === 'string', 'invalid cmd in create task request');
  assert(typeof data.cwd === 'string', 'invalid cwd in create task request');
  assert(data.description === undefined || typeof data.description === 'string', 'invalid description in create task request');
  assert(data.stdout === undefined || typeof data.stdout === 'string', 'invalid stdout in create task request');
  assert(data.stderr === undefined || typeof data.stderr === 'string', 'invalid stderr in create task request');

  if (data.arguments !== undefined) {
    assert(Array.isArray(data.arguments), 'invalid arguments in launch task instance request');
    for (let i = 0; i < data.arguments.length; i++) {
      assert(typeof data.arguments[i] === 'string', 'invalid arguments[i] in launch task instance request');
    }
  }

  if (data.env !== undefined) {
    assert(typeof data.env === 'object', 'invalid env in launch task instance request');
    lodash.forOwn(data.env, (v, k) => {
      assert(typeof v === 'string', 'invalid env value in launch task instance request');
    });
  }

  if (data.type === 'job') {
    assert(data.firstLaunchAt === undefined || (typeof data.firstLaunchAt === 'number' && data.firstLaunchAt > 0), 'invalid firstLaunchAt in create task request');
    assert(data.duration === undefined || (typeof data.duration === 'number' && data.duration >= 5000 && Math.round(data.duration) === data.duration), 'invalid duration in create task request');
  } else if (data.type === 'service') {
    if (data.healthCheck !== undefined) {
      assertHealthCheck(data.healthCheck);
    }
  } else {
    assert(false, 'invalid type in create task request');
  }
}

function assertHealthCheck(healthCheck: HealthCheck): asserts healthCheck is HealthCheck {
  if (healthCheck.type === 'passive') {
    assert(
      healthCheck.periodInMs === undefined || (typeof healthCheck.periodInMs === 'number' && healthCheck.periodInMs >= 1000 && Math.round(healthCheck.periodInMs) === healthCheck.periodInMs),
      'invalid periodInMs in healthCheck',
    );
  } else if (healthCheck.type === 'ping') {
    assert(typeof healthCheck.domain === 'string', 'invalid domain in healthCheck');
    assert(healthCheck.path === undefined || typeof healthCheck.path === 'string', 'invalid path in healthCheck');
    assert(
      healthCheck.periodInMs === undefined || (typeof healthCheck.periodInMs === 'number' && healthCheck.periodInMs >= 1000 && Math.round(healthCheck.periodInMs) === healthCheck.periodInMs),
      'invalid periodInMs in healthCheck',
    );
  } else {
    assert(false, 'invalid type in healthCheck');
  }
}

export function assertUpdateTaskRequest(data: UpdateTaskRequest): asserts data is UpdateTaskRequest {
  assert(data !== undefined, 'invalid update task request');
  assert(typeof data.taskId === 'string', 'invalid taskId in update task request');
  assert(typeof data.name === 'string', 'invalid name in update task request');
  assert(typeof data.cmd === 'string', 'invalid cmd in update task request');
  assert(typeof data.cwd === 'string', 'invalid cwd in update task request');
  assert(data.description === undefined || typeof data.description === 'string', 'invalid description in update task request');
  assert(data.stdout === undefined || typeof data.stdout === 'string', 'invalid stdout in update task request');
  assert(data.stderr === undefined || typeof data.stderr === 'string', 'invalid stderr in update task request');

  if (data.arguments !== undefined) {
    assert(Array.isArray(data.arguments), 'invalid arguments in launch task instance request');
    for (let i = 0; i < data.arguments.length; i++) {
      assert(typeof data.arguments[i] === 'string', 'invalid arguments[i] in launch task instance request');
    }
  }

  if (data.env !== undefined) {
    assert(typeof data.env === 'object', 'invalid env in launch task instance request');
    lodash.forOwn(data.env, (v, k) => {
      assert(typeof v === 'string', 'invalid env value in launch task instance request');
    });
  }
  if (data.type === 'job') {
    assert(data.firstLaunchAt === undefined || (typeof data.firstLaunchAt === 'number' && data.firstLaunchAt > 0), 'invalid firstLaunchAt in update task request');
    assert(data.duration === undefined || (typeof data.duration === 'number' && data.duration >= 5000 && Math.round(data.duration) === data.duration), 'invalid duration in update task request');
  } else if (data.type === 'service') {
    if (data.healthCheck !== undefined) {
      assertHealthCheck(data.healthCheck);
    }
  } else {
    assert(false, 'invalid type in update task request');
  }
}

export function assertTaskId(data: any): asserts data is { taskId: string } {
  assert(data !== undefined, 'invalid taskId');
  assert(typeof data.taskId === 'string', 'invalid taskId');
}

export function assertDeleteTaskRequest(data: DeleteTaskRequest): asserts data is DeleteTaskRequest {
  assert(data !== undefined, 'invalid taskId');
  assert(typeof data.taskId === 'string', 'invalid taskId');
}

export function assertListHealthChecksRequest(data: ListHealthChecksRequest): asserts data is ListHealthChecksRequest {
  assert(data !== undefined, 'invalid list health checks request');
  assert(Array.isArray(data.taskIdentifiers), 'invalid taskIdentifiers in list health checks request');
  for (let i = 0; i < data.taskIdentifiers.length; i++) {
    const identifier = data.taskIdentifiers[i];
    assert(typeof identifier?.taskId === 'string', 'invalid taskId in list health checks request');
    assert(typeof identifier?.version === 'number', 'invalid version in list health checks request');
  }
}

export function convertToGetTaskRequest(data: any): GetTaskRequest {
  let taskId: string;
  let version: number | undefined = undefined;
  if (typeof data?.taskId === 'string') {
    taskId = data.taskId;
  } else {
    throw error('invalid taskId');
  }

  if (typeof data?.version === 'string') {
    const _version = Number(data.version);
    if (!Number.isNaN(_version) && _version >= 0 && Math.round(_version) === _version) {
      version = _version;
    } else {
      throw error('invalid version');
    }
  }

  return {
    taskId,
    version,
  };
}

export function convertToGetTaskDynamicsRequest(data: any): GetTaskDynamicsRequest {
  let taskId: string;
  if (typeof data?.taskId === 'string') {
    taskId = data.taskId;
  } else {
    throw error('invalid taskId');
  }

  return {
    taskId,
  };
}

export function assertResetTaskTargetAgentsRequest(data: ResetTaskTargetAgentsRequest): asserts data is ResetTaskTargetAgentsRequest {
  assert(data !== undefined, 'invalid reset task target agents request');
  assert(typeof data.taskId === 'string', 'invalid taskId in reset task target agents request');
  assert(Array.isArray(data.targetAgentIds), 'invalid targetAgentIds in reset task target agents request');
  for (let i = 0; i < data.targetAgentIds.length; i++) {
    assert(typeof data.targetAgentIds[i] === 'string', 'invalid targetAgentIds[i] in reset task target agents request');
  }
}

export function assertResetTaskActiveRequest(data: ResetTaskActiveRequest): asserts data is ResetTaskActiveRequest {
  assert(data !== undefined, 'invalid reset task active request');
  assert(typeof data.taskId === 'string', 'invalid taskId in reset task active request');
  assert(typeof data.active === 'boolean', 'invalid taskId in reset task active request');
}

export function assertListRunningInstancesRequest(data: ListRunningInstancesRequest): asserts data is ListRunningInstancesRequest {
  assert(data !== undefined, 'invalid ListRunningInstancesRequest');
  assert(typeof data.agentId === 'string', 'invalid agentId in ListRunningInstancesRequest');
}

export function convertToListTaskInstancesRequest(data: any): ListTaskInstancesRequest {
  let taskId: string | undefined = undefined;
  let version: number | undefined = undefined;
  let status: TaskInstanceStatus | undefined = undefined;
  let from: number | undefined = undefined;
  let to: number | undefined = undefined;
  let agentId: string | undefined = undefined;

  if (typeof data?.taskId === 'string') {
    taskId = data.taskId;
  }

  if (typeof data?.agentId === 'string') {
    agentId = data.agentId;
  }

  if (typeof data?.version === 'string') {
    const _version = Number(data.version);
    if (!Number.isNaN(_version) && _version >= 0 && Math.round(_version) === _version) {
      version = _version;
    } else {
      throw error('invalid version');
    }
  }

  if (typeof data?.status === 'string') {
    if (TASK_INSTANCE_STATUSES.includes(data.status)) {
      status = data.status;
    } else {
      throw error('invalid status');
    }
  }

  if (typeof data?.from === 'string') {
    const _from = Number(data.from);
    if (!Number.isNaN(_from) && _from >= 0 && Math.round(_from) === _from) {
      from = _from;
    } else {
      throw error('invalid from timestamp');
    }
  }

  if (typeof data?.to === 'string') {
    const _to = Number(data.to);
    if (!Number.isNaN(_to) && _to >= 0 && Math.round(_to) === _to) {
      to = _to;
    } else {
      throw error('invalid to timestamp');
    }
  }

  return {
    taskId,
    version,
    status,
    from: from,
    to: to,
    agentId,
  };
}

export function convertToListTaskEventsRequest(data: any): ListTaskEventsRequest {
  let taskInstanceId: string;
  if (typeof data?.taskInstanceId === 'string') {
    taskInstanceId = data.taskInstanceId;
  } else {
    throw error('invalid taskInstanceId');
  }

  return {
    taskInstanceId: taskInstanceId,
  };
}

export function convertToGetTaskInstanceRequest(data: any): GetTaskInstanceRequest {
  let taskInstanceId: string;
  if (typeof data?.taskInstanceId === 'string') {
    taskInstanceId = data.taskInstanceId;
  } else {
    throw error('invalid taskInstanceId');
  }

  return {
    taskInstanceId: taskInstanceId,
  };
}

export function assertLaunchTaskRequest(data: LaunchTaskRequest): asserts data is LaunchTaskRequest {
  assert(data !== undefined, 'invalid launch task request');
  assert(typeof data.taskId === 'string', 'invalid taskId in launch task request');
  assert(Array.isArray(data.targetAgentIds), 'invalid targetAgentIds in launch task request');
  for (let i = 0; i < data.targetAgentIds.length; i++) {
    assert(typeof data.targetAgentIds[i] === 'string', `invalid targetAgentIds[${i}] in launch task request`);
  }

  if (data.arguments !== undefined) {
    assert(Array.isArray(data.arguments), 'invalid arguments in launch task request');
    for (let i = 0; i < data.arguments.length; i++) {
      assert(typeof data.arguments[i] === 'string', `invalid arguments[${i}] in launch task request`);
    }
  }
}

export function assertTerminateTaskInstanceRequest(data: TerminateTaskInstanceRequest): asserts data is TerminateTaskInstanceRequest {
  assert(data !== undefined, 'invalid terminate task instance request');
  assert(typeof data.taskInstanceId === 'string', 'invalid taskInstanceId in terminate task instance request');
}

export function assertTerminateTaskAgentRequest(data: TerminateTaskAgentRequest): asserts data is TerminateTaskAgentRequest {
  assert(data !== undefined, 'invalid terminate task agent request');
  assert(typeof data.agentId === 'string', 'invalid agentId in terminate task agent request');
}

export function assertResetReplacementVariablesRequest(data: ResetReplacementVariablesRequest): asserts data is ResetReplacementVariablesRequest {
  assert(data !== undefined, 'invalid reset replacement variables request');
  assert(typeof data.variables === 'object', 'invalid variables in reset replacement variables request');
  lodash.forOwn(data.variables, (v, k) => {
    assert(typeof v === 'string', 'invalid variable in reset replacement variables request');
  });
}

function error(message: string) {
  return new InvalidRequestError(message);
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw error(message);
  }
}

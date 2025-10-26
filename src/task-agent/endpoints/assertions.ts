import { EnhancedError, Errors } from '@qinnan/standard-error';
import { ExitCode, HealthCheck, InstanceEvent, LaunchTaskInstanceRequest, TaskEventLevel, TaskServiceEvent } from '@qinnan/task-types';
import lodash from 'lodash';

const TASK_EVENT_LEVELS: ReadonlyArray<TaskEventLevel> = ['error', 'success', 'warning'];

export function assertTaskInstancePid(data: any): asserts data is { taskInstanceId: string; pid: number } {
  assert(data !== undefined, 'invalid report task instance pid request');
  assert(typeof data.taskInstanceId === 'string', 'invalid taskInstanceId in report task instance pid request');
  assert(typeof data.pid === 'number', 'invalid pid in report task instance pid request');
}

export function assertTaskInstanceId(data: any): asserts data is { taskInstanceId: string } {
  assert(data !== undefined, 'invalid taskInstanceId');
  assert(typeof data.taskInstanceId === 'string', 'invalid taskInstanceId');
}

export function assertTaskInstanceExit(data: any): asserts data is { taskInstanceId: string; code?: ExitCode } {
  assert(data !== undefined, 'invalid taskInstanceExit');
  assert(typeof data.taskInstanceId === 'string', 'invalid taskInstanceId in taskInstanceExit');
  if (data.code !== undefined) {
    assert(data.code === 0 || data.code === -1, 'invalid code in taskInstanceExit');
  }
}

export function assertInstanceEvent(data: any): asserts data is InstanceEvent {
  assert(data !== undefined, 'invalid instance event');
  assert(typeof data.instanceId === 'string', 'invalid instanceId in instance event');
  assert(typeof data.timestamp === 'number', 'invalid timestamp in instance event');
  assert(TASK_EVENT_LEVELS.includes(data.level), 'invalid level in instance event');
  assert(typeof data.payload === 'string' || typeof data.payload === 'object', 'invalid payload in instance event');
}

export function assertTaskServiceEvent(data: TaskServiceEvent): asserts data is TaskServiceEvent {
  assert(data !== undefined, 'invalid task service event');
  if (data.type === 'launch-task') {
    assert(typeof data.agentId === 'string', 'invalid agentId in launch task event');
    assertLaunchTaskInstanceRequest(data.request);
  } else if (data.type === 'terminate-task-instance') {
    assert(typeof data.agentId === 'string', 'invalid agentId in terminate task instance event');
    assert(typeof data.instanceId === 'string', 'invalid instanceId in terminate task instance event');
    assert(typeof data.pid === 'number', 'invalid pid in terminate task instance event');
  } else if (data.type === 'terminate-agent') {
    assert(typeof data.agentId === 'string', 'invalid agentId in terminate agent');
  } else if (data.type === 'request-agent-status') {
    assert(data.agentId === undefined || typeof data.agentId === 'string', 'invalid agentId in request-agent-status request');
  } else {
    assert(false, 'invalid type in task service event');
  }
}

export function assertLaunchTaskInstanceRequest(data: LaunchTaskInstanceRequest): asserts data is LaunchTaskInstanceRequest {
  assert(data !== undefined, 'invalid launch task instance request');
  assert(typeof data.taskId === 'string', 'invalid taskId in launch task instance request');
  assert(typeof data.version === 'number', 'invalid version in launch task instance request');
  assert(typeof data.taskInstanceId === 'string', 'invalid taskInstanceId in launch task instance request');
  assert(typeof data.cmd === 'string', 'invalid cmd in launch task instance request');
  assert(typeof data.cwd === 'string', 'invalid cwd in launch task instance request');

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

  assert(data.stdout === undefined || typeof data.stdout === 'string', 'invalid stdout in launch task instance request');
  assert(data.stderr === undefined || typeof data.stderr === 'string', 'invalid stderr in launch task instance request');

  if (data.healthCheck !== undefined) {
    assertHealthCheck(data.healthCheck);
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

function error(message: string) {
  return EnhancedError.create(Errors.INVALID_REQUEST, 400, message);
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw error(message);
  }
}

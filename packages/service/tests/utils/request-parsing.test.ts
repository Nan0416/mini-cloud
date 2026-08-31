import { InvalidRequestError } from '@mini-cloud/shared';
import {
  optionalLimitParam,
  optionalVersionParam,
  parseBroadcastRequest,
  parseCreateTaskRequest,
  parseHeartbeatRequest,
  parseLaunchTaskRequest,
  parseListHealthChecksRequest,
  parseListTaskInstancesQuery,
  parseReportInstancePidRequest,
  parseReportInstanceStatusRequest,
  parseReportTaskEventRequest,
  parseSendToRequest,
  parseSetReplacementVariablesRequest,
  parseSetTaskActiveRequest,
  parseSetTaskTargetAgentsRequest,
  parseUpdateTaskRequest,
  requireInstanceIdParam,
  requireStringField,
  requireTaskIdParam,
} from '../../src/utils/request-parsing';

/**
 * This is the whole trust boundary in one file: everything that arrives over HTTP is
 * `unknown` until it has been through here. What is worth pinning down is not that a
 * well-formed body parses — the routes would fail loudly — but the rules that only
 * exist here, where the only evidence they still hold is a test:
 *
 *   - the cross-field rules (`duration` needs an anchor, `version` needs a `taskId`)
 *   - the range floors that keep the scheduler and health monitor able to keep up
 *   - the fields a caller may *not* set, which must be rejected rather than ignored
 *   - which subset of an enum each endpoint accepts, which is narrower than the type
 */
const job = { name: 'nightly backup', type: 'job', cmd: 'backup.sh', cwd: '/srv' };
const service = { name: 'api', type: 'service', cmd: 'server.js', cwd: '/srv' };

describe('parseCreateTaskRequest', () => {
  it('parses the common fields shared by both task types', () => {
    expect(
      parseCreateTaskRequest({
        ...job,
        description: 'runs at 3am',
        arguments: ['--full'],
        env: { STAGE: 'prod' },
        stdout: '/var/log/out',
        stderr: '/var/log/err',
      }),
    ).toEqual({
      name: 'nightly backup',
      description: 'runs at 3am',
      type: 'job',
      cmd: 'backup.sh',
      cwd: '/srv',
      arguments: ['--full'],
      env: { STAGE: 'prod' },
      stdout: '/var/log/out',
      stderr: '/var/log/err',
      duration: undefined,
      firstLaunchAt: undefined,
    });
  });

  it('requires the fields without which a process cannot be spawned', () => {
    expect(() => parseCreateTaskRequest({ ...job, name: '' })).toThrow('name must not be empty');
    expect(() => parseCreateTaskRequest({ ...job, cmd: undefined })).toThrow(/cmd/);
    expect(() => parseCreateTaskRequest({ ...job, cwd: '' })).toThrow(/cwd/);
  });

  it('rejects a body that is not an object at all', () => {
    expect(() => parseCreateTaskRequest(null)).toThrow('body must be an object');
    expect(() => parseCreateTaskRequest([job])).toThrow('body must be an object');
    expect(() => parseCreateTaskRequest('{}')).toThrow(InvalidRequestError);
  });

  it('rejects a type outside the union', () => {
    expect(() => parseCreateTaskRequest({ ...job, type: 'cronjob' })).toThrow('type must be one of [job, service]');
  });

  describe('job scheduling fields', () => {
    it('accepts a one-shot job: an anchor with no interval', () => {
      expect(parseCreateTaskRequest({ ...job, firstLaunchAt: 1_800_000_000_000 })).toMatchObject({
        firstLaunchAt: 1_800_000_000_000,
        duration: undefined,
      });
    });

    it('accepts a manual-only job: neither field', () => {
      expect(parseCreateTaskRequest(job)).toMatchObject({ duration: undefined, firstLaunchAt: undefined });
    });

    it('rejects an interval with nothing to repeat from', () => {
      // The scheduler projects occurrences forward from the anchor; without one there
      // is no series to project, and the job would simply never fire.
      expect(() => parseCreateTaskRequest({ ...job, duration: 60_000 })).toThrow('firstLaunchAt is required when duration is set');
    });

    it('rejects an interval the scheduler tick cannot keep up with', () => {
      expect(() => parseCreateTaskRequest({ ...job, duration: 4_999, firstLaunchAt: 1 })).toThrow('duration must be at least 5000ms');
      expect(parseCreateTaskRequest({ ...job, duration: 5_000, firstLaunchAt: 1 })).toMatchObject({ duration: 5_000 });
    });

    it('rejects a non-positive anchor, which is a unit mix-up rather than a time', () => {
      // Seconds-instead-of-milliseconds and an uninitialised 0 both land here.
      expect(() => parseCreateTaskRequest({ ...job, firstLaunchAt: 0 })).toThrow('firstLaunchAt must be a positive epoch timestamp in milliseconds');
      expect(() => parseCreateTaskRequest({ ...job, firstLaunchAt: -1 })).toThrow(/positive epoch/);
    });

    it('rejects fractional scheduling values', () => {
      expect(() => parseCreateTaskRequest({ ...job, duration: 5_000.5, firstLaunchAt: 1 })).toThrow('duration must be an integer');
    });
  });

  describe('service health checks', () => {
    it('accepts a service with no health check', () => {
      expect(parseCreateTaskRequest(service)).toMatchObject({ type: 'service', healthCheck: undefined });
    });

    it('parses a ping check', () => {
      expect(parseCreateTaskRequest({ ...service, healthCheck: { type: 'ping', url: 'http://127.0.0.1:8080/healthz', periodInMs: 5_000 } })).toMatchObject({
        healthCheck: { type: 'ping', url: 'http://127.0.0.1:8080/healthz', periodInMs: 5_000 },
      });
    });

    it('parses a passive check, which carries no url', () => {
      expect(parseCreateTaskRequest({ ...service, healthCheck: { type: 'passive' } })).toMatchObject({
        healthCheck: { type: 'passive', periodInMs: undefined },
      });
    });

    it('rejects a url that is not absolute, at creation rather than at every probe', () => {
      // A relative url means every probe fails once the task is already running, and
      // the failure looks like the task being unhealthy rather than misconfigured.
      expect(() => parseCreateTaskRequest({ ...service, healthCheck: { type: 'ping', url: '/healthz' } })).toThrow('healthCheck.url must be an absolute URL (got "/healthz")');
      expect(() => parseCreateTaskRequest({ ...service, healthCheck: { type: 'ping', url: 'not a url' } })).toThrow(/absolute URL/);
    });

    it('requires a url for a ping check', () => {
      expect(() => parseCreateTaskRequest({ ...service, healthCheck: { type: 'ping' } })).toThrow(/healthCheck\.url/);
    });

    it('rejects a probe period faster than the monitor can poll', () => {
      expect(() => parseCreateTaskRequest({ ...service, healthCheck: { type: 'passive', periodInMs: 999 } })).toThrow('healthCheck.periodInMs must be at least 1000');
      expect(parseCreateTaskRequest({ ...service, healthCheck: { type: 'passive', periodInMs: 1_000 } })).toMatchObject({
        healthCheck: { periodInMs: 1_000 },
      });
    });

    it('rejects a health check type outside the union', () => {
      expect(() => parseCreateTaskRequest({ ...service, healthCheck: { type: 'tcp', url: 'http://x' } })).toThrow('healthCheck.type must be one of [ping, passive]');
    });

    it('ignores a health check on a job, which has no process to keep alive', () => {
      expect(parseCreateTaskRequest({ ...job, healthCheck: { type: 'ping', url: '/nonsense' } })).not.toHaveProperty('healthCheck');
    });
  });
});

describe('parseUpdateTaskRequest', () => {
  it('requires the id of the task being versioned', () => {
    // The only field that separates this from a create: without it the service would
    // have nothing to attach the new version to.
    expect(() => parseUpdateTaskRequest(job)).toThrow(/taskId/);
    expect(parseUpdateTaskRequest({ ...job, taskId: 't1' })).toMatchObject({ taskId: 't1', type: 'job' });
  });

  it('applies the same field rules as a create', () => {
    expect(() => parseUpdateTaskRequest({ ...job, taskId: 't1', duration: 1_000, firstLaunchAt: 1 })).toThrow(/at least 5000ms/);
    expect(parseUpdateTaskRequest({ ...service, taskId: 't1', healthCheck: { type: 'passive' } })).toMatchObject({
      type: 'service',
      healthCheck: { type: 'passive' },
    });
  });
});

describe('parseLaunchTaskRequest', () => {
  it('takes a task id and optional overrides', () => {
    expect(parseLaunchTaskRequest({ taskId: 't1', targetAgentIds: ['mac-mini'], arguments: ['--now'] })).toEqual({
      taskId: 't1',
      targetAgentIds: ['mac-mini'],
      arguments: ['--now'],
    });
  });

  it('leaves both overrides absent when they are not given, so stored values apply', () => {
    expect(parseLaunchTaskRequest({ taskId: 't1' })).toEqual({ taskId: 't1', targetAgentIds: undefined, arguments: undefined });
  });

  it('distinguishes an empty target list from an absent one', () => {
    // Absent means "use the task's configured targets"; empty means "launch nowhere",
    // and collapsing the two would launch a task the caller asked not to launch.
    expect(parseLaunchTaskRequest({ taskId: 't1', targetAgentIds: [] }).targetAgentIds).toEqual([]);
  });

  it('rejects a missing task id', () => {
    expect(() => parseLaunchTaskRequest({})).toThrow(/taskId/);
  });
});

describe('parseSetTaskActiveRequest', () => {
  it('requires a real boolean, not a truthy value', () => {
    expect(parseSetTaskActiveRequest({ taskId: 't1', active: false })).toEqual({ taskId: 't1', active: false });
    expect(() => parseSetTaskActiveRequest({ taskId: 't1', active: 'false' })).toThrow('active must be a boolean');
    expect(() => parseSetTaskActiveRequest({ taskId: 't1' })).toThrow(/active/);
  });
});

describe('parseSetTaskTargetAgentsRequest', () => {
  it('requires the list, since this endpoint replaces it wholesale', () => {
    // Unlike a launch override, omitting it here is not "leave it alone" — there is
    // no other meaning for the call, so it is an error rather than a no-op.
    expect(() => parseSetTaskTargetAgentsRequest({ taskId: 't1' })).toThrow(/targetAgentIds/);
    expect(parseSetTaskTargetAgentsRequest({ taskId: 't1', targetAgentIds: [] })).toEqual({ taskId: 't1', targetAgentIds: [] });
  });

  it('names the offending entry when one is not a string', () => {
    expect(() => parseSetTaskTargetAgentsRequest({ taskId: 't1', targetAgentIds: ['a', 2] })).toThrow('targetAgentIds[1] must be a string');
  });
});

describe('parseSetReplacementVariablesRequest', () => {
  it('requires a string-to-string map', () => {
    expect(parseSetReplacementVariablesRequest({ variables: { ROOT: '/srv' } })).toEqual({ variables: { ROOT: '/srv' } });
    expect(parseSetReplacementVariablesRequest({ variables: {} })).toEqual({ variables: {} });
    expect(() => parseSetReplacementVariablesRequest({ variables: { PORT: 8080 } })).toThrow('variables.PORT must be a string');
  });
});

describe('parseListTaskInstancesQuery', () => {
  it('parses every filter out of the query string, where all values are text', () => {
    expect(parseListTaskInstancesQuery({ taskId: 't1', version: '3', agentId: 'mac-mini', status: 'running', from: '100', to: '200', limit: '10' })).toEqual({
      taskId: 't1',
      version: 3,
      agentId: 'mac-mini',
      status: 'running',
      from: 100,
      to: 200,
      limit: 10,
    });
  });

  it('accepts an empty query, which lists everything', () => {
    expect(parseListTaskInstancesQuery({})).toEqual({
      taskId: undefined,
      version: undefined,
      agentId: undefined,
      status: undefined,
      from: undefined,
      to: undefined,
      limit: undefined,
    });
  });

  it('rejects a version with no task to version', () => {
    // Instances of "version 3" across every task is not a question with an answer.
    expect(() => parseListTaskInstancesQuery({ version: '3' })).toThrow('taskId is required when version is given');
  });

  it('accepts the full instance status vocabulary, not just what an agent reports', () => {
    // A reader may filter on statuses only the service assigns, unlike the report
    // endpoint, which is deliberately narrower.
    expect(parseListTaskInstancesQuery({ status: 'initiation_failed' }).status).toBe('initiation_failed');
    expect(() => parseListTaskInstancesQuery({ status: 'halfway' })).toThrow(/status must be one of/);
  });

  it('rejects a non-numeric window', () => {
    expect(() => parseListTaskInstancesQuery({ from: 'yesterday' })).toThrow('from must be an integer');
  });
});

describe('parseHeartbeatRequest', () => {
  it('requires both the id and the display name', () => {
    expect(parseHeartbeatRequest({ agentId: 'mac-mini', name: 'Mac mini' })).toEqual({ agentId: 'mac-mini', name: 'Mac mini' });
    expect(() => parseHeartbeatRequest({ agentId: 'mac-mini' })).toThrow(/name/);
    expect(() => parseHeartbeatRequest({ agentId: '', name: 'Mac mini' })).toThrow('agentId must not be empty');
  });
});

describe('parseReportInstanceStatusRequest', () => {
  it('accepts the statuses an agent can actually observe', () => {
    for (const status of ['launched', 'failed_to_launch', 'running', 'terminating', 'terminated', 'exit_success', 'exit_failure', 'health_check_failure']) {
      expect(parseReportInstanceStatusRequest({ instanceId: 'i1', status }).status).toBe(status);
    }
  });

  it("refuses statuses that are the service's to assign", () => {
    // `initiated` and `initiation_failed` describe the service's own dispatch attempt,
    // and `start_timeout` is a judgement the service makes about the agent. An agent
    // claiming one would be overwriting the service's account of its own actions.
    for (const status of ['init', 'initiated', 'initiation_failed', 'launching_timeout', 'start_timeout', 'termination_initiated']) {
      expect(() => parseReportInstanceStatusRequest({ instanceId: 'i1', status })).toThrow(/status must be one of/);
    }
  });

  it('requires the instance being reported on', () => {
    expect(() => parseReportInstanceStatusRequest({ status: 'running' })).toThrow(/instanceId/);
  });
});

describe('parseReportInstancePidRequest', () => {
  it('takes a positive process id', () => {
    expect(parseReportInstancePidRequest({ instanceId: 'i1', pid: 4211 })).toEqual({ instanceId: 'i1', pid: 4211 });
  });

  it('rejects a pid no process can have', () => {
    // 0 is what an uninitialised field holds, and a negative pid is a process group
    // in kill(2) — sending one to `process.kill` would signal the whole group.
    expect(() => parseReportInstancePidRequest({ instanceId: 'i1', pid: 0 })).toThrow('pid must be positive');
    expect(() => parseReportInstancePidRequest({ instanceId: 'i1', pid: -1 })).toThrow('pid must be positive');
  });

  it('rejects a non-integer pid', () => {
    expect(() => parseReportInstancePidRequest({ instanceId: 'i1', pid: '4211' })).toThrow('pid must be a number');
    expect(() => parseReportInstancePidRequest({ instanceId: 'i1', pid: 4211.5 })).toThrow('pid must be an integer');
  });
});

describe('parseReportTaskEventRequest', () => {
  it('parses an event reported by an agent or a task', () => {
    expect(parseReportTaskEventRequest({ instanceId: 'i1', source: 'agent', timestamp: 1_700_000_000_000, level: 'success', payload: 'spawned' })).toEqual({
      instanceId: 'i1',
      source: 'agent',
      timestamp: 1_700_000_000_000,
      level: 'success',
      payload: 'spawned',
    });
  });

  it('reserves the `service` source for the service itself', () => {
    // Otherwise anything holding a token could forge entries in the audit log that
    // read as though the control plane wrote them.
    expect(() => parseReportTaskEventRequest({ instanceId: 'i1', source: 'service', timestamp: 1, level: 'error', payload: 'x' })).toThrow('source must be one of [agent, task]');
  });

  it('accepts any JSON payload, since it is stored as JSONB with its type intact', () => {
    const parse = (payload: unknown) => parseReportTaskEventRequest({ instanceId: 'i1', source: 'task', timestamp: 1, level: 'success', payload }).payload;

    expect(parse({ message: 'done', code: 0 })).toEqual({ message: 'done', code: 0 });
    expect(parse([1, 2])).toEqual([1, 2]);
    expect(parse(null)).toBeNull();
    expect(parse(0)).toBe(0);
    expect(parse('')).toBe('');
  });

  it('requires a payload to be present, even though its shape is unconstrained', () => {
    expect(() => parseReportTaskEventRequest({ instanceId: 'i1', source: 'task', timestamp: 1, level: 'success' })).toThrow('payload is required');
  });

  it("requires a level from the event vocabulary, not the logger's", () => {
    expect(() => parseReportTaskEventRequest({ instanceId: 'i1', source: 'task', timestamp: 1, level: 'info', payload: 'x' })).toThrow(
      'level must be one of [success, warning, error]',
    );
  });

  it('requires an integer timestamp', () => {
    expect(() => parseReportTaskEventRequest({ instanceId: 'i1', source: 'task', timestamp: '1', level: 'success', payload: 'x' })).toThrow('timestamp must be a number');
  });
});

describe('parseListHealthChecksRequest', () => {
  it('parses a list of exact task versions', () => {
    expect(
      parseListHealthChecksRequest({
        taskIdentifiers: [
          { taskId: 'a', version: 1 },
          { taskId: 'b', version: 2 },
        ],
      }),
    ).toEqual({
      taskIdentifiers: [
        { taskId: 'a', version: 1 },
        { taskId: 'b', version: 2 },
      ],
    });
  });

  it('accepts an empty list', () => {
    expect(parseListHealthChecksRequest({ taskIdentifiers: [] })).toEqual({ taskIdentifiers: [] });
  });

  it('points at the entry that is wrong, not just at the list', () => {
    // An agent sending fifty identifiers needs to know which one it got wrong.
    expect(() => parseListHealthChecksRequest({ taskIdentifiers: [{ taskId: 'a', version: 1 }, { taskId: 'b' }] })).toThrow('taskIdentifiers[1].version must be a number');
    expect(() => parseListHealthChecksRequest({ taskIdentifiers: [{ version: 1 }] })).toThrow('taskIdentifiers[0].taskId must be a string');
    expect(() => parseListHealthChecksRequest({ taskIdentifiers: ['a'] })).toThrow('taskIdentifiers[0] must be an object');
  });

  it('requires the list itself', () => {
    expect(() => parseListHealthChecksRequest({})).toThrow('taskIdentifiers must be an array');
  });
});

/**
 * Attribution is decided by the connection a message arrived on, never by the body.
 * Rejecting `senderId` rather than dropping it is the point: a publisher that set it
 * and got a 200 back would reasonably believe recipients see it as the sender.
 */
describe('parseBroadcastRequest', () => {
  it('parses a topic message', () => {
    expect(parseBroadcastRequest({ topic: 'builds', publishedAt: 1_700_000_000_000, payload: { ok: true } })).toEqual({
      topic: 'builds',
      publishedAt: 1_700_000_000_000,
      payload: { ok: true },
    });
  });

  it('refuses to let an HTTP publisher claim a sender', () => {
    expect(() => parseBroadcastRequest({ topic: 'builds', publishedAt: 1, payload: 'x', senderId: 'someone-else' })).toThrow(/senderId cannot be set by a publisher/);
  });

  it('allows an explicit undefined, which is what an omitted optional serialises to in JS', () => {
    expect(parseBroadcastRequest({ topic: 'builds', publishedAt: 1, payload: 'x', senderId: undefined })).toMatchObject({ topic: 'builds' });
  });

  it('requires a topic and a payload', () => {
    expect(() => parseBroadcastRequest({ publishedAt: 1, payload: 'x' })).toThrow(/topic/);
    expect(() => parseBroadcastRequest({ topic: 'builds', publishedAt: 1 })).toThrow('payload is required');
  });

  it('requires publishedAt, which only a hand-rolled request can omit', () => {
    // `MiniCloudClient` fills it in, so its absence means something else built the
    // request — and a message with no send time cannot be ordered against others.
    expect(() => parseBroadcastRequest({ topic: 'builds', payload: 'x' })).toThrow('publishedAt must be a number');
  });
});

describe('parseSendToRequest', () => {
  it('parses a directed message', () => {
    expect(parseSendToRequest({ recipientId: 'sub-1', publishedAt: 1, payload: 'x' })).toEqual({ recipientId: 'sub-1', publishedAt: 1, payload: 'x' });
  });

  it('refuses a claimed sender here too', () => {
    expect(() => parseSendToRequest({ recipientId: 'sub-1', publishedAt: 1, payload: 'x', senderId: 'someone-else' })).toThrow(/senderId cannot be set/);
  });

  it('requires a recipient', () => {
    expect(() => parseSendToRequest({ publishedAt: 1, payload: 'x' })).toThrow(/recipientId/);
  });
});

describe('path and query parameter helpers', () => {
  it('requires a task id', () => {
    expect(requireTaskIdParam({ taskId: 't1' })).toBe('t1');
    expect(() => requireTaskIdParam({})).toThrow(/taskId/);
    expect(() => requireTaskIdParam({ taskId: '' })).toThrow('taskId must not be empty');
  });

  it('requires an instance id', () => {
    expect(requireInstanceIdParam({ instanceId: 'i1' })).toBe('i1');
    expect(() => requireInstanceIdParam({})).toThrow(/instanceId/);
  });

  it('reads an optional version, absent meaning the latest', () => {
    expect(optionalVersionParam({ version: '3' })).toBe(3);
    expect(optionalVersionParam({})).toBeUndefined();
    // `/tasks/t1?version=` is what a cleared form field produces.
    expect(optionalVersionParam({ version: '' })).toBeUndefined();
    expect(() => optionalVersionParam({ version: 'latest' })).toThrow('version must be an integer');
  });

  it('reads an optional limit, absent meaning the default', () => {
    expect(optionalLimitParam({ limit: '50' })).toBe(50);
    expect(optionalLimitParam({})).toBeUndefined();
    expect(() => optionalLimitParam({ limit: 'all' })).toThrow('limit must be an integer');
  });

  it('reads a named required field, reporting it by that name', () => {
    expect(requireStringField({ agentId: 'mac-mini' }, 'agentId')).toBe('mac-mini');
    expect(() => requireStringField({}, 'agentId')).toThrow('agentId must be a string');
  });

  it('rejects a query that is not an object', () => {
    expect(() => requireTaskIdParam(undefined)).toThrow('query must be an object');
    expect(() => requireStringField(undefined, 'agentId')).toThrow('body must be an object');
  });
});

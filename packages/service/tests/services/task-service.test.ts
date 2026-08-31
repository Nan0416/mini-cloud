import { ConflictError, InvalidRequestError, NotFoundError, TaskInstance } from '@mini-cloud/shared';
import { TaskDispatcher } from '../../src/facades/task-dispatcher';
import { TaskService } from '../../src/services/task-service';
import { FakeAgentCommander, FakeTaskDao, FakeTaskDynamicsDao, FakeTaskEventDao, FakeTaskInstanceDao, FakeVariableDao, NOW, aJob, aService } from '../data/fake-daos';

/**
 * `TaskDispatcher` is wired in for real rather than faked. It is the other half of a
 * launch — the instance row, the command, the event trail — and stubbing it would
 * leave the most interesting assertion here ("what actually reached the agent?")
 * with nothing behind it. Everything below it is a fake.
 */
const build = () => {
  const taskDao = new FakeTaskDao();
  const taskDynamicsDao = new FakeTaskDynamicsDao();
  const taskInstanceDao = new FakeTaskInstanceDao();
  const taskEventDao = new FakeTaskEventDao();
  const variableDao = new FakeVariableDao();
  const agentCommander = new FakeAgentCommander();
  const taskDispatcher = new TaskDispatcher({ taskInstanceDao, taskEventDao, agentCommander });
  const service = new TaskService({ taskDao, taskDynamicsDao, taskInstanceDao, taskEventDao, variableDao, agentCommander, taskDispatcher });
  return { taskDao, taskDynamicsDao, taskInstanceDao, taskEventDao, variableDao, agentCommander, service };
};

const createJobRequest = {
  name: 'nightly backup',
  type: 'job' as const,
  cmd: 'backup.sh',
  cwd: '/srv',
};

const anInstance = (overrides: Partial<TaskInstance> = {}): TaskInstance => ({
  instanceId: 'i1',
  taskId: 't1',
  taskVersion: 1,
  agentId: 'mac-mini',
  status: 'running',
  pid: 4211,
  createdAt: NOW,
  lastUpdatedAt: NOW,
  ...overrides,
});

describe('TaskService.createTask', () => {
  it('assigns an id and starts at version 1', async () => {
    const { service } = build();

    const { taskId, version } = await service.createTask(createJobRequest);

    expect(version).toBe(1);
    expect(taskId).toMatch(/^\d{10}$/);
  });

  it('gives every task a distinct id', async () => {
    const { service } = build();

    const first = await service.createTask(createJobRequest);
    const second = await service.createTask(createJobRequest);

    expect(first.taskId).not.toBe(second.taskId);
  });

  it('stores the definition so it reads back', async () => {
    const { service } = build();

    const { taskId } = await service.createTask({ ...createJobRequest, duration: 60_000, firstLaunchAt: NOW });

    expect((await service.getTask({ taskId })).task).toMatchObject({ type: 'job', duration: 60_000, firstLaunchAt: NOW, cmd: 'backup.sh' });
  });

  it('stores a service with its health check', async () => {
    const { service } = build();
    const healthCheck = { type: 'passive' as const, periodInMs: 5_000 };

    const { taskId } = await service.createTask({ name: 'api', type: 'service', cmd: 'server.js', cwd: '/srv', healthCheck });

    expect((await service.getTask({ taskId })).task).toMatchObject({ type: 'service', healthCheck });
  });
});

describe('TaskService.updateTask', () => {
  it('writes a new version rather than mutating the old one', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aJob({ version: 1, name: 'first' }));

    const { version } = await service.updateTask({ ...createJobRequest, taskId: 't1', name: 'second' });

    expect(version).toBe(2);
    // The old version stays resolvable, which is what lets a running instance report
    // against the definition it was launched from.
    expect((await service.getTask({ taskId: 't1', version: 1 })).task?.name).toBe('first');
    expect((await service.getTask({ taskId: 't1' })).task?.name).toBe('second');
  });

  it('numbers from the current head, so versions never collide', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aJob({ version: 1 }), aJob({ version: 2 }), aJob({ version: 3 }));

    expect((await service.updateTask({ ...createJobRequest, taskId: 't1' })).version).toBe(4);
  });

  it('refuses to turn a job into a service', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aJob());

    // The two have different lifecycles; switching would orphan running instances
    // that were launched under the old semantics.
    await expect(service.updateTask({ taskId: 't1', name: 'api', type: 'service', cmd: 'x', cwd: '/srv' })).rejects.toThrow(ConflictError);
    await expect(service.updateTask({ taskId: 't1', name: 'api', type: 'service', cmd: 'x', cwd: '/srv' })).rejects.toThrow(/is a job and cannot be changed into a service/);
  });

  it('refuses to turn a service into a job', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aService({ taskId: 't1' }));

    await expect(service.updateTask({ ...createJobRequest, taskId: 't1' })).rejects.toThrow(ConflictError);
  });

  it('rejects an update to a task that does not exist', async () => {
    const { service } = build();

    await expect(service.updateTask({ ...createJobRequest, taskId: 'nope' })).rejects.toThrow(NotFoundError);
  });
});

describe('TaskService.deleteTask', () => {
  it('removes every version', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aJob({ version: 1 }), aJob({ version: 2 }));

    await service.deleteTask({ taskId: 't1' });

    await expect(service.getTask({ taskId: 't1' })).rejects.toThrow(NotFoundError);
    await expect(service.getTask({ taskId: 't1', version: 1 })).rejects.toThrow(NotFoundError);
  });

  it('leaves the instance history behind on purpose', async () => {
    const { taskDao, taskInstanceDao, service } = build();
    taskDao.seed(aJob());
    taskInstanceDao.seed(anInstance());

    await service.deleteTask({ taskId: 't1' });

    // A deleted task's runs stay readable until retention prunes them; otherwise
    // deleting a task would erase the record of what it did.
    expect((await service.getInstance({ instanceId: 'i1' })).instance).toMatchObject({ taskId: 't1' });
  });

  it('rejects a delete of a task that does not exist', async () => {
    const { service } = build();

    await expect(service.deleteTask({ taskId: 'nope' })).rejects.toThrow('Task nope does not exist.');
  });
});

describe('TaskService.getTask', () => {
  it('returns the head when no version is asked for', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aJob({ version: 1 }), aJob({ version: 2 }));

    expect((await service.getTask({ taskId: 't1' })).task?.version).toBe(2);
  });

  it('says which of the two things is missing', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aJob({ version: 1 }));

    // "Task t1 does not exist" for a task the caller can see in the list would send
    // them looking in the wrong place entirely.
    await expect(service.getTask({ taskId: 'nope' })).rejects.toThrow('Task nope does not exist.');
    await expect(service.getTask({ taskId: 't1', version: 9 })).rejects.toThrow('Task t1 version 9 does not exist.');
  });
});

describe('TaskService.listTasks', () => {
  it('returns one entry per task, at its head version', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aJob({ taskId: 'a', version: 1 }), aJob({ taskId: 'a', version: 2 }), aJob({ taskId: 'b', version: 1 }));

    const { tasks } = await service.listTasks({});

    expect(tasks.map((task) => [task.taskId, task.version])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
});

describe('TaskService.listHealthChecks', () => {
  it('returns checks only for the versions that have one', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aService({ taskId: 's1', version: 1, healthCheck: { type: 'passive' } }), aService({ taskId: 's2', version: 1 }));

    const { healthChecks } = await service.listHealthChecks({
      taskIdentifiers: [
        { taskId: 's1', version: 1 },
        { taskId: 's2', version: 1 },
      ],
    });

    expect(healthChecks).toEqual([{ taskId: 's1', version: 1, healthCheck: { type: 'passive' } }]);
  });
});

/**
 * Dynamics are created lazily, so "not configured" and "configured as inactive" are
 * the same thing to a reader and different things in the database.
 */
describe('TaskService.getDynamics', () => {
  it('materialises defaults for a task that has never been scheduled', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aJob());

    expect((await service.getDynamics({ taskId: 't1' })).dynamics).toEqual({ taskId: 't1', active: false, targetAgentIds: [] });
  });

  it('returns the stored row once there is one', async () => {
    const { taskDao, taskDynamicsDao, service } = build();
    taskDao.seed(aJob());
    taskDynamicsDao.seed({ taskId: 't1', active: true, targetAgentIds: ['mac-mini'] });

    expect((await service.getDynamics({ taskId: 't1' })).dynamics).toEqual({ taskId: 't1', active: true, targetAgentIds: ['mac-mini'] });
  });

  it('rejects a task that does not exist rather than inventing defaults for it', async () => {
    const { service } = build();

    // Without this check a typo would answer 200 with a plausible-looking row.
    await expect(service.getDynamics({ taskId: 'nope' })).rejects.toThrow(NotFoundError);
  });
});

describe('TaskService.setActive', () => {
  it('activates a task and leaves its targets alone', async () => {
    const { taskDao, taskDynamicsDao, service } = build();
    taskDao.seed(aJob());
    taskDynamicsDao.seed({ taskId: 't1', active: false, targetAgentIds: ['mac-mini'] });

    const { dynamics } = await service.setActive({ taskId: 't1', active: true });

    expect(dynamics).toEqual({ taskId: 't1', active: true, targetAgentIds: ['mac-mini'] });
  });

  it('creates the row when the task has never been scheduled', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aJob());

    expect((await service.setActive({ taskId: 't1', active: true })).dynamics).toEqual({ taskId: 't1', active: true, targetAgentIds: [] });
  });

  it('rejects a task that does not exist', async () => {
    const { service } = build();

    await expect(service.setActive({ taskId: 'nope', active: true })).rejects.toThrow('Task nope does not exist.');
  });
});

describe('TaskService.setTargetAgents', () => {
  it('replaces the target list and leaves `active` alone', async () => {
    const { taskDao, taskDynamicsDao, service } = build();
    taskDao.seed(aJob());
    taskDynamicsDao.seed({ taskId: 't1', active: true, targetAgentIds: ['old'] });

    const { dynamics } = await service.setTargetAgents({ taskId: 't1', targetAgentIds: ['a', 'b'] });

    expect(dynamics).toEqual({ taskId: 't1', active: true, targetAgentIds: ['a', 'b'] });
  });

  it('accepts an empty list, which untargets the task', async () => {
    const { taskDao, taskDynamicsDao, service } = build();
    taskDao.seed(aJob());
    taskDynamicsDao.seed({ taskId: 't1', active: true, targetAgentIds: ['old'] });

    expect((await service.setTargetAgents({ taskId: 't1', targetAgentIds: [] })).dynamics.targetAgentIds).toEqual([]);
  });

  it('rejects a task that does not exist', async () => {
    const { service } = build();

    await expect(service.setTargetAgents({ taskId: 'nope', targetAgentIds: [] })).rejects.toThrow(NotFoundError);
  });
});

describe('TaskService replacement variables', () => {
  it('reads the stored set', async () => {
    const { variableDao, service } = build();
    variableDao.seed({ ROOT: '/srv/app' });

    expect((await service.listVariables({})).variables).toEqual({ ROOT: '/srv/app' });
  });

  it('replaces the whole set, so an omitted key is deleted', async () => {
    const { variableDao, service } = build();
    variableDao.seed({ ROOT: '/srv/app', STAGE: 'beta' });

    const { variables } = await service.setVariables({ variables: { ROOT: '/srv/new' } });

    expect(variables).toEqual({ ROOT: '/srv/new' });
  });

  it('accepts an empty set, which clears the table', async () => {
    const { variableDao, service } = build();
    variableDao.seed({ ROOT: '/srv/app' });

    expect((await service.setVariables({ variables: {} })).variables).toEqual({});
  });
});

describe('TaskService instances', () => {
  it('returns an instance by id', async () => {
    const { taskInstanceDao, service } = build();
    taskInstanceDao.seed(anInstance());

    expect((await service.getInstance({ instanceId: 'i1' })).instance).toMatchObject({ instanceId: 'i1', status: 'running' });
  });

  it('rejects an instance that does not exist', async () => {
    const { service } = build();

    await expect(service.getInstance({ instanceId: 'nope' })).rejects.toThrow('Task instance nope does not exist.');
  });

  it('passes the filters through to the listing', async () => {
    const { taskInstanceDao, service } = build();
    taskInstanceDao.seed(anInstance({ instanceId: 'i1', agentId: 'a' }), anInstance({ instanceId: 'i2', agentId: 'b' }));

    expect((await service.listInstances({ agentId: 'b' })).instances.map((instance) => instance.instanceId)).toEqual(['i2']);
  });
});

describe('TaskService.recordStatus', () => {
  it('applies a status that moves the instance forward', async () => {
    const { taskInstanceDao, service } = build();
    taskInstanceDao.seed(anInstance({ status: 'launched' }));

    await service.recordStatus({ instanceId: 'i1', status: 'running' });

    expect(taskInstanceDao.statusOf('i1')).toBe('running');
  });

  it('accepts a stale report without complaint, and does not apply it', async () => {
    const { taskInstanceDao, service } = build();
    taskInstanceDao.seed(anInstance({ status: 'exit_success' }));

    // Reports race over the network and the older one loses. That is normal traffic,
    // not a client error — telling the agent it failed would make it retry forever.
    await expect(service.recordStatus({ instanceId: 'i1', status: 'running' })).resolves.toEqual({});
    expect(taskInstanceDao.statusOf('i1')).toBe('exit_success');
  });

  it('rejects a report for an instance that does not exist', async () => {
    const { service } = build();

    await expect(service.recordStatus({ instanceId: 'nope', status: 'running' })).rejects.toThrow(NotFoundError);
  });
});

describe('TaskService.recordPid', () => {
  it('stores the pid the task reported for itself', async () => {
    const { taskInstanceDao, service } = build();
    taskInstanceDao.seed(anInstance({ pid: undefined, status: 'launched' }));

    await service.recordPid({ instanceId: 'i1', pid: 4211 });

    expect(taskInstanceDao.instances.get('i1')?.pid).toBe(4211);
  });

  it('rejects a pid for an instance that does not exist', async () => {
    const { service } = build();

    await expect(service.recordPid({ instanceId: 'nope', pid: 4211 })).rejects.toThrow(NotFoundError);
  });
});

describe('TaskService events', () => {
  it('assigns an id to every event', async () => {
    const { taskEventDao, service } = build();

    await service.addEvent({ instanceId: 'i1', source: 'agent', level: 'success', payload: 'spawned', timestamp: NOW });

    expect(taskEventDao.events[0]?.eventId).toMatch(/^[0-9a-z]{16}$/);
  });

  it('keeps the reported payload and timestamp intact', async () => {
    const { taskEventDao, service } = build();

    await service.addEvent({ instanceId: 'i1', source: 'task', level: 'error', payload: { code: 1 }, timestamp: NOW });

    expect(taskEventDao.events[0]).toMatchObject({ instanceId: 'i1', source: 'task', level: 'error', payload: { code: 1 }, timestamp: NOW });
  });

  it('lists the events for one instance', async () => {
    const { service } = build();
    await service.addEvent({ instanceId: 'i1', source: 'agent', level: 'success', payload: 'a', timestamp: NOW });
    await service.addEvent({ instanceId: 'i2', source: 'agent', level: 'success', payload: 'b', timestamp: NOW });

    expect((await service.listEvents({ instanceId: 'i1' })).events.map((event) => event.payload)).toEqual(['a']);
  });

  it('caps an unbounded listing at 500', async () => {
    const { taskEventDao, service } = build();

    await service.listEvents({ instanceId: 'i1' });

    // A chatty task can write thousands of events; without a default the console
    // would try to render all of them.
    expect(taskEventDao.lastListLimit).toBe(500);
  });

  it('honours an explicit limit', async () => {
    const { taskEventDao, service } = build();

    await service.listEvents({ instanceId: 'i1', limit: 10 });

    expect(taskEventDao.lastListLimit).toBe(10);
  });
});

describe('TaskService.launchTask', () => {
  it('launches on the agents the caller named', async () => {
    const { taskDao, agentCommander, service } = build();
    taskDao.seed(aJob());
    agentCommander.connect('a', 'b');

    const { results } = await service.launchTask({ taskId: 't1', targetAgentIds: ['a', 'b'] });

    expect(results.map((result) => [result.agentId, result.status])).toEqual([
      ['a', 'initiated'],
      ['b', 'initiated'],
    ]);
  });

  it("falls back to the task's configured agents when none are named", async () => {
    const { taskDao, taskDynamicsDao, agentCommander, service } = build();
    taskDao.seed(aJob());
    taskDynamicsDao.seed({ taskId: 't1', active: true, targetAgentIds: ['mac-mini'] });
    agentCommander.connect('mac-mini');

    const { results } = await service.launchTask({ taskId: 't1' });

    expect(results.map((result) => result.agentId)).toEqual(['mac-mini']);
  });

  it('prefers the named agents over the configured ones', async () => {
    const { taskDao, taskDynamicsDao, agentCommander, service } = build();
    taskDao.seed(aJob());
    taskDynamicsDao.seed({ taskId: 't1', active: true, targetAgentIds: ['configured'] });
    agentCommander.connect('named');

    const { results } = await service.launchTask({ taskId: 't1', targetAgentIds: ['named'] });

    expect(results.map((result) => result.agentId)).toEqual(['named']);
  });

  it('refuses a launch that would go nowhere, rather than reporting success', async () => {
    const { taskDao, service } = build();
    taskDao.seed(aJob());

    // Returning an empty result list would read as "launched, on zero agents".
    await expect(service.launchTask({ taskId: 't1' })).rejects.toThrow(InvalidRequestError);
    await expect(service.launchTask({ taskId: 't1' })).rejects.toThrow(/has no target agents/);
  });

  it('refuses an explicitly empty target list too', async () => {
    const { taskDao, taskDynamicsDao, service } = build();
    taskDao.seed(aJob());
    taskDynamicsDao.seed({ taskId: 't1', active: true, targetAgentIds: ['mac-mini'] });

    await expect(service.launchTask({ taskId: 't1', targetAgentIds: [] })).rejects.toThrow(InvalidRequestError);
  });

  it('rejects a launch of a task that does not exist', async () => {
    const { service } = build();

    await expect(service.launchTask({ taskId: 'nope', targetAgentIds: ['a'] })).rejects.toThrow(NotFoundError);
  });

  it('resolves replacement variables before the instruction leaves', async () => {
    const { taskDao, variableDao, agentCommander, service } = build();
    taskDao.seed(aJob({ cmd: '${ROOT}/backup.sh', cwd: '${ROOT}' }));
    variableDao.seed({ ROOT: '/srv/app' });
    agentCommander.connect('a');

    await service.launchTask({ taskId: 't1', targetAgentIds: ['a'] });

    // The agent receives a resolved instruction; it does not know the variable table
    // exists, so anything left unsubstituted here reaches the shell verbatim.
    expect(agentCommander.launches[0]).toMatchObject({ cmd: '/srv/app/backup.sh', cwd: '/srv/app' });
  });

  it("appends per-launch arguments after the task's own", async () => {
    const { taskDao, agentCommander, service } = build();
    taskDao.seed(aJob({ arguments: ['--full'] }));
    agentCommander.connect('a');

    await service.launchTask({ taskId: 't1', targetAgentIds: ['a'], arguments: ['--now'] });

    expect(agentCommander.launches[0]?.arguments).toEqual(['--full', '--now']);
  });

  it('records why a launch that reached nobody failed', async () => {
    const { taskDao, taskInstanceDao, taskEventDao, service } = build();
    taskDao.seed(aJob());

    const { results } = await service.launchTask({ taskId: 't1', targetAgentIds: ['offline-agent'] });

    // The instance row is written before the command is sent, precisely so a launch
    // that never arrives still leaves a record explaining why.
    const instanceId = results[0]?.instanceId as string;
    expect(results[0]?.status).toBe('initiation_failed');
    expect(taskInstanceDao.statusOf(instanceId)).toBe('initiation_failed');
    expect(taskEventDao.payloadsFor(instanceId)).toEqual([expect.stringContaining('not connected')]);
  });

  it('launches on the reachable agents even when others are offline', async () => {
    const { taskDao, agentCommander, service } = build();
    taskDao.seed(aJob());
    agentCommander.connect('up');

    const { results } = await service.launchTask({ taskId: 't1', targetAgentIds: ['up', 'down'] });

    // One unreachable machine must not cancel the launch on the rest of the fleet.
    expect(results.map((result) => [result.agentId, result.status])).toEqual([
      ['up', 'initiated'],
      ['down', 'initiation_failed'],
    ]);
  });
});

describe('TaskService.terminateInstance', () => {
  const running = () => {
    const context = build();
    context.taskInstanceDao.seed(anInstance({ status: 'running', pid: 4211 }));
    return context;
  };

  it('sends the terminate command with the pid the task reported', async () => {
    const { agentCommander, taskInstanceDao, service } = running();
    agentCommander.connect('mac-mini');

    await service.terminateInstance({ instanceId: 'i1' });

    expect(agentCommander.sent).toEqual([{ agentId: 'mac-mini', command: { type: 'terminate-instance', instanceId: 'i1', pid: 4211 } }]);
    expect(taskInstanceDao.statusOf('i1')).toBe('termination_initiated');
  });

  it('records an event alongside the status change', async () => {
    const { agentCommander, taskEventDao, service } = running();
    agentCommander.connect('mac-mini');

    await service.terminateInstance({ instanceId: 'i1' });

    expect(taskEventDao.payloadsFor('i1')).toEqual([expect.stringContaining('Sent terminate command for pid 4211')]);
    expect(taskEventDao.events[0]).toMatchObject({ source: 'service', level: 'success' });
  });

  it('fails the termination when the agent is not connected', async () => {
    const { taskInstanceDao, taskEventDao, service } = running();

    await expect(service.terminateInstance({ instanceId: 'i1' })).rejects.toThrow(ConflictError);

    // The caller is told, and the instance carries the record — otherwise it would
    // sit at `running` with no sign that anyone tried to stop it.
    expect(taskInstanceDao.statusOf('i1')).toBe('termination_failed');
    expect(taskEventDao.events[0]).toMatchObject({ source: 'service', level: 'error' });
  });

  it('refuses an instance that has not reported a pid', async () => {
    const { taskInstanceDao, agentCommander, service } = build();
    taskInstanceDao.seed(anInstance({ status: 'launched', pid: undefined }));
    agentCommander.connect('mac-mini');

    // The agent spawns detached, so the only pid it can signal is the one the task
    // reported for itself.
    await expect(service.terminateInstance({ instanceId: 'i1' })).rejects.toThrow(/has not reported a pid yet/);
    expect(agentCommander.sent).toEqual([]);
  });

  it('refuses an instance that has already finished', async () => {
    const { taskInstanceDao, service } = build();
    taskInstanceDao.seed(anInstance({ status: 'exit_success' }));

    await expect(service.terminateInstance({ instanceId: 'i1' })).rejects.toThrow('Instance i1 is "exit_success" and is not running.');
  });

  it('refuses every terminal status', async () => {
    for (const status of ['terminated', 'exit_success', 'exit_failure', 'init'] as const) {
      const { taskInstanceDao, service } = build();
      taskInstanceDao.seed(anInstance({ status }));

      await expect(service.terminateInstance({ instanceId: 'i1' })).rejects.toThrow(ConflictError);
    }
  });

  it('allows a second attempt on an instance already terminating', async () => {
    const { taskInstanceDao, agentCommander, service } = build();
    taskInstanceDao.seed(anInstance({ status: 'terminating' }));
    agentCommander.connect('mac-mini');

    // SIGINT can be ignored, so re-sending is a legitimate thing for an operator to
    // do rather than a conflict.
    await expect(service.terminateInstance({ instanceId: 'i1' })).resolves.toEqual({});
  });

  it('rejects an instance that does not exist', async () => {
    const { service } = build();

    await expect(service.terminateInstance({ instanceId: 'nope' })).rejects.toThrow(NotFoundError);
  });
});

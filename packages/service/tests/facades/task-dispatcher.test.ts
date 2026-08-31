import { Task } from '@mini-cloud/shared';
import { TaskDispatcher } from '../../src/facades/task-dispatcher';
import { FakeAgentCommander, FakeTaskEventDao, FakeTaskInstanceDao, aJob, aService } from '../data/fake-daos';

const build = () => {
  const taskInstanceDao = new FakeTaskInstanceDao();
  const taskEventDao = new FakeTaskEventDao();
  const agentCommander = new FakeAgentCommander();
  return { taskInstanceDao, taskEventDao, agentCommander, dispatcher: new TaskDispatcher({ taskInstanceDao, taskEventDao, agentCommander }) };
};

const dispatch = (dispatcher: TaskDispatcher, task: Task, agentIds: ReadonlyArray<string>, variables = {}, extraArguments?: ReadonlyArray<string>) =>
  dispatcher.dispatch({ task, agentIds, variables, extraArguments });

describe('TaskDispatcher.dispatch', () => {
  it('creates an instance and sends a launch for each agent', async () => {
    const { agentCommander, taskInstanceDao, dispatcher } = build();
    agentCommander.connect('a', 'b');

    const { results } = await dispatch(dispatcher, aJob(), ['a', 'b']);

    expect(results).toHaveLength(2);
    expect(taskInstanceDao.instances.size).toBe(2);
    expect(agentCommander.launches).toHaveLength(2);
  });

  it('gives each agent its own instance id', async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('a', 'b');

    const { results } = await dispatch(dispatcher, aJob(), ['a', 'b']);

    // One launch across two machines is two runs; sharing an id would merge their
    // statuses and event logs into one unreadable stream.
    expect(results[0]?.instanceId).not.toBe(results[1]?.instanceId);
    expect(results[0]?.instanceId).toMatch(/^[0-9a-z]{12}$/);
  });

  it('reports which task version each instance was launched from', async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('a');

    const { results } = await dispatch(dispatcher, aJob({ version: 7 }), ['a']);

    expect(results[0]).toMatchObject({ taskId: 't1', taskVersion: 7, agentId: 'a', status: 'initiated' });
  });

  it('writes the instance row before sending the command', async () => {
    const { taskInstanceDao, dispatcher } = build();

    // Nothing is connected, so the command fails — and the row must still exist,
    // which is the whole reason for this ordering.
    const { results } = await dispatch(dispatcher, aJob(), ['offline']);

    expect(taskInstanceDao.instances.has(results[0]?.instanceId as string)).toBe(true);
  });

  it('moves a delivered launch to initiated, with an event saying so', async () => {
    const { agentCommander, taskInstanceDao, taskEventDao, dispatcher } = build();
    agentCommander.connect('a');

    const { results } = await dispatch(dispatcher, aJob({ version: 2 }), ['a']);
    const instanceId = results[0]?.instanceId as string;

    expect(taskInstanceDao.statusOf(instanceId)).toBe('initiated');
    expect(taskEventDao.payloadsFor(instanceId)).toEqual(['Dispatched launch of task t1 v2 to agent a.']);
    expect(taskEventDao.events[0]).toMatchObject({ source: 'service', level: 'success' });
  });

  it('moves an undelivered launch to initiation_failed, and says why in the result', async () => {
    const { taskInstanceDao, taskEventDao, dispatcher } = build();

    const { results } = await dispatch(dispatcher, aJob(), ['offline']);
    const instanceId = results[0]?.instanceId as string;

    expect(results[0]).toMatchObject({ status: 'initiation_failed', message: expect.stringContaining('not connected') });
    expect(taskInstanceDao.statusOf(instanceId)).toBe('initiation_failed');
    expect(taskEventDao.events[0]).toMatchObject({ source: 'service', level: 'error' });
  });

  it('carries on to the remaining agents after one is unreachable', async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('up');

    const { results } = await dispatch(dispatcher, aJob(), ['down', 'up']);

    // A launch across the fleet must not be abandoned because the first machine in
    // the list happens to be off.
    expect(results.map((result) => result.status)).toEqual(['initiation_failed', 'initiated']);
  });

  it('does nothing at all for an empty agent list', async () => {
    const { taskInstanceDao, agentCommander, dispatcher } = build();

    const { results } = await dispatch(dispatcher, aJob(), []);

    expect(results).toEqual([]);
    expect(taskInstanceDao.instances.size).toBe(0);
    expect(agentCommander.sent).toEqual([]);
  });
});

describe('TaskDispatcher instruction building', () => {
  it('substitutes variables into every field that supports them', async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('a');
    const task = aJob({
      cmd: '${ROOT}/backup.sh',
      cwd: '${ROOT}',
      arguments: ['--out', '${ROOT}/dump'],
      env: { DATA_DIR: '${ROOT}/data' },
      stdout: '${ROOT}/out.log',
      stderr: '${ROOT}/err.log',
    });

    await dispatch(dispatcher, task, ['a'], { ROOT: '/srv/app' });

    expect(agentCommander.launches[0]).toMatchObject({
      cmd: '/srv/app/backup.sh',
      cwd: '/srv/app',
      arguments: ['--out', '/srv/app/dump'],
      env: { DATA_DIR: '/srv/app/data' },
      stdout: '/srv/app/out.log',
      stderr: '/srv/app/err.log',
    });
  });

  it('substitutes once, so every agent runs byte-identical arguments', async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('a', 'b');

    await dispatch(dispatcher, aJob({ cmd: '${ROOT}/run' }), ['a', 'b'], { ROOT: '/srv' });

    // Instances across the fleet are only comparable if they ran the same command.
    expect(agentCommander.launches[0]?.cmd).toBe(agentCommander.launches[1]?.cmd);
  });

  it("appends per-launch arguments after the task's own", async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('a');

    await dispatch(dispatcher, aJob({ arguments: ['--full'] }), ['a'], {}, ['--now']);

    // Appended, not replacing: the task's own arguments are part of its definition.
    expect(agentCommander.launches[0]?.arguments).toEqual(['--full', '--now']);
  });

  it('uses the extra arguments alone when the task defines none', async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('a');

    await dispatch(dispatcher, aJob(), ['a'], {}, ['--now']);

    expect(agentCommander.launches[0]?.arguments).toEqual(['--now']);
  });

  it('leaves the arguments absent when there are none of either kind', async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('a');

    await dispatch(dispatcher, aJob(), ['a']);

    // Absent rather than `[]`, so the agent spawns with no argv rather than one that
    // happens to be empty.
    expect(agentCommander.launches[0]?.arguments).toBeUndefined();
  });

  it('does not mutate the task it was given', async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('a');
    const task = aJob({ cmd: '${ROOT}/run', arguments: ['--full'] });

    await dispatch(dispatcher, task, ['a'], { ROOT: '/srv' }, ['--now']);

    // The caller holds the stored definition; substituting in place would corrupt it
    // for every later launch in the same process.
    expect(task.cmd).toBe('${ROOT}/run');
    expect(task.arguments).toEqual(['--full']);
  });

  it("sends a service's health check so the agent knows how to probe it", async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('a');
    const healthCheck = { type: 'ping' as const, url: 'http://127.0.0.1:8080/healthz' };

    await dispatch(dispatcher, aService({ healthCheck }), ['a']);

    expect(agentCommander.launches[0]?.healthCheck).toEqual(healthCheck);
  });

  it('sends no health check for a job, which is expected to exit', async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('a');

    await dispatch(dispatcher, aJob(), ['a']);

    expect(agentCommander.launches[0]?.healthCheck).toBeUndefined();
  });

  it('identifies the instance so the agent can report against it', async () => {
    const { agentCommander, dispatcher } = build();
    agentCommander.connect('a');

    const { results } = await dispatch(dispatcher, aJob({ version: 3 }), ['a']);

    expect(agentCommander.launches[0]).toMatchObject({ taskId: 't1', version: 3, instanceId: results[0]?.instanceId });
  });
});

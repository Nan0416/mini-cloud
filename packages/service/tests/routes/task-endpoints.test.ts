import { CreateTaskResponse, ErrorResponse, GetTaskResponse, ListTaskInstancesResponse, ListTasksResponse } from '@mini-cloud/shared';
import { TaskDispatcher } from '../../src/facades/task-dispatcher';
import { TaskEndpoints } from '../../src/routes/task-endpoints';
import { TaskService } from '../../src/services/task-service';
import { FakeAgentCommander, FakeTaskDao, FakeTaskDynamicsDao, FakeTaskEventDao, FakeTaskInstanceDao, FakeVariableDao, NOW, aJob } from '../data/fake-daos';
import { TestServer } from './test-helpers';

const context = () => {
  const taskDao = new FakeTaskDao();
  const taskDynamicsDao = new FakeTaskDynamicsDao();
  const taskInstanceDao = new FakeTaskInstanceDao();
  const taskEventDao = new FakeTaskEventDao();
  const variableDao = new FakeVariableDao();
  const agentCommander = new FakeAgentCommander();
  const taskDispatcher = new TaskDispatcher({ taskInstanceDao, taskEventDao, agentCommander });
  const taskService = new TaskService({ taskDao, taskDynamicsDao, taskInstanceDao, taskEventDao, variableDao, agentCommander, taskDispatcher });
  return { taskDao, taskDynamicsDao, taskInstanceDao, taskEventDao, variableDao, agentCommander, taskService };
};

let fakes: ReturnType<typeof context>;
let server: TestServer;

beforeEach(async () => {
  fakes = context();
  server = await TestServer.start(new TaskEndpoints({ taskService: fakes.taskService }));
});

afterEach(async () => {
  await server.close();
});

const createJob = { name: 'nightly backup', type: 'job', cmd: 'backup.sh', cwd: '/srv' };

describe('task definition routes', () => {
  it('answers 201 for a create, because a resource came into existence', async () => {
    const response = await server.post<CreateTaskResponse>('/tasks', createJob);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ taskId: expect.stringMatching(/^\d{10}$/), version: 1 });
  });

  it('answers 200 for a read', async () => {
    fakes.taskDao.seed(aJob());

    const response = await server.get<GetTaskResponse>('/tasks/t1');

    expect(response.status).toBe(200);
    expect(response.body.task).toMatchObject({ taskId: 't1', name: 'nightly backup' });
  });

  it('lists tasks', async () => {
    fakes.taskDao.seed(aJob({ taskId: 'a' }), aJob({ taskId: 'b' }));

    const response = await server.get<ListTasksResponse>('/tasks');

    expect(response.status).toBe(200);
    expect(response.body.tasks).toHaveLength(2);
  });

  it('reads the version out of the query string', async () => {
    fakes.taskDao.seed(aJob({ version: 1, name: 'first' }), aJob({ version: 2, name: 'second' }));

    expect((await server.get<GetTaskResponse>('/tasks/t1?version=1')).body.task?.name).toBe('first');
    expect((await server.get<GetTaskResponse>('/tasks/t1')).body.task?.name).toBe('second');
  });

  it('rejects a version that is not a number', async () => {
    const response = await server.get<ErrorResponse>('/tasks/t1?version=latest');

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('INVALID_REQUEST');
  });

  it('takes the task id from the path, not the body', async () => {
    fakes.taskDao.seed(aJob({ taskId: 'from-path' }));

    // The path is the resource being addressed; a body field of the same name must
    // not be able to redirect the write to a different task.
    const response = await server.put('/tasks/from-path', { ...createJob, taskId: 'from-body' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ taskId: 'from-path', version: 2 });
  });

  it('deletes a task', async () => {
    fakes.taskDao.seed(aJob());

    expect((await server.delete('/tasks/t1')).status).toBe(200);
    expect((await server.get('/tasks/t1')).status).toBe(404);
  });

  it('answers 404 for a task that does not exist, with the message the service wrote', async () => {
    const response = await server.get<ErrorResponse>('/tasks/nope');

    // Express 5 forwards a rejected promise to the error handler, which is why none of
    // these handlers carry a try/catch. Without that the request would hang.
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Task nope does not exist.', errorCode: 'NOT_FOUND' });
  });

  it("answers 409 when an update would change a task's type", async () => {
    fakes.taskDao.seed(aJob());

    const response = await server.put<ErrorResponse>('/tasks/t1', { name: 'api', type: 'service', cmd: 'x', cwd: '/srv' });

    expect(response.status).toBe(409);
    expect(response.body.errorCode).toBe('CONFLICT');
  });

  it('answers 400 for a body that fails validation', async () => {
    const response = await server.post<ErrorResponse>('/tasks', { ...createJob, name: '' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('name must not be empty');
  });

  it('answers 400 for a body that is not an object', async () => {
    const response = await server.post<ErrorResponse>('/tasks', ['not', 'an', 'object']);

    expect(response.status).toBe(400);
  });
});

describe('schedule state routes', () => {
  it('materialises default dynamics for a task that has never been scheduled', async () => {
    fakes.taskDao.seed(aJob());

    const response = await server.get('/tasks/t1/dynamics');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ dynamics: { taskId: 't1', active: false, targetAgentIds: [] } });
  });

  it('sets a task active, taking the id from the path', async () => {
    fakes.taskDao.seed(aJob());

    const response = await server.put('/tasks/t1/active', { active: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ dynamics: { taskId: 't1', active: true, targetAgentIds: [] } });
  });

  it('rejects a non-boolean active flag', async () => {
    fakes.taskDao.seed(aJob());

    expect((await server.put<ErrorResponse>('/tasks/t1/active', { active: 'yes' })).status).toBe(400);
  });

  it('sets the target agents', async () => {
    fakes.taskDao.seed(aJob());

    const response = await server.put('/tasks/t1/target-agents', { targetAgentIds: ['mac-mini'] });

    expect(response.body).toEqual({ dynamics: { taskId: 't1', active: false, targetAgentIds: ['mac-mini'] } });
  });

  it('answers 404 when setting state on a task that does not exist', async () => {
    expect((await server.put('/tasks/nope/active', { active: true })).status).toBe(404);
  });
});

describe('launch routes', () => {
  it('launches a task and reports one result per agent', async () => {
    fakes.taskDao.seed(aJob());
    fakes.agentCommander.connect('a');

    const response = await server.post('/tasks/t1/launch', { targetAgentIds: ['a'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: [expect.objectContaining({ agentId: 'a', status: 'initiated' })] });
  });

  it('answers 400 when a launch would go nowhere', async () => {
    fakes.taskDao.seed(aJob());

    const response = await server.post<ErrorResponse>('/tasks/t1/launch');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/has no target agents/);
  });

  it('terminates an instance', async () => {
    fakes.taskInstanceDao.seed({
      instanceId: 'i1',
      taskId: 't1',
      taskVersion: 1,
      agentId: 'mac-mini',
      status: 'running',
      pid: 4211,
      createdAt: NOW,
      lastUpdatedAt: NOW,
    });
    fakes.agentCommander.connect('mac-mini');

    expect((await server.post('/instances/i1/terminate')).status).toBe(200);
    expect(fakes.taskInstanceDao.statusOf('i1')).toBe('termination_initiated');
  });

  it('answers 409 when the instance cannot be terminated', async () => {
    fakes.taskInstanceDao.seed({
      instanceId: 'i1',
      taskId: 't1',
      taskVersion: 1,
      agentId: 'mac-mini',
      status: 'exit_success',
      createdAt: NOW,
      lastUpdatedAt: NOW,
    });

    const response = await server.post<ErrorResponse>('/instances/i1/terminate');

    expect(response.status).toBe(409);
    expect(response.body.errorCode).toBe('CONFLICT');
  });
});

describe('instance routes', () => {
  const seedInstances = () => {
    fakes.taskInstanceDao.seed(
      { instanceId: 'i1', taskId: 't1', taskVersion: 1, agentId: 'a', status: 'running', createdAt: NOW, lastUpdatedAt: NOW },
      { instanceId: 'i2', taskId: 't2', taskVersion: 1, agentId: 'b', status: 'exit_success', createdAt: NOW, lastUpdatedAt: NOW },
    );
  };

  it('reads every filter out of the query string', async () => {
    seedInstances();

    const response = await server.get<ListTaskInstancesResponse>('/instances?agentId=b&status=exit_success');

    expect(response.status).toBe(200);
    expect(response.body.instances.map((instance) => instance.instanceId)).toEqual(['i2']);
  });

  it('lists everything when no filter is given', async () => {
    seedInstances();

    expect((await server.get<ListTaskInstancesResponse>('/instances')).body.instances).toHaveLength(2);
  });

  it('answers 400 for a version filter with no task', async () => {
    const response = await server.get<ErrorResponse>('/instances?version=3');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('taskId is required when version is given');
  });

  it('answers 404 for an instance that does not exist', async () => {
    expect((await server.get('/instances/nope')).status).toBe(404);
  });

  it('lists the events for an instance, honouring a limit', async () => {
    await fakes.taskService.addEvent({ instanceId: 'i1', source: 'agent', level: 'success', payload: 'a', timestamp: NOW });
    await fakes.taskService.addEvent({ instanceId: 'i1', source: 'agent', level: 'success', payload: 'b', timestamp: NOW });

    expect((await server.get('/instances/i1/events')).status).toBe(200);
    expect(fakes.taskEventDao.lastListLimit).toBe(500);

    await server.get('/instances/i1/events?limit=1');
    expect(fakes.taskEventDao.lastListLimit).toBe(1);
  });
});

describe('variable routes', () => {
  it('reads the stored set', async () => {
    fakes.variableDao.seed({ ROOT: '/srv/app' });

    const response = await server.get('/variables');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ variables: { ROOT: '/srv/app' } });
  });

  it('replaces the whole set', async () => {
    fakes.variableDao.seed({ ROOT: '/srv/app', STAGE: 'beta' });

    const response = await server.put('/variables', { variables: { ROOT: '/srv/new' } });

    expect(response.body).toEqual({ variables: { ROOT: '/srv/new' } });
  });

  it('answers 400 for a value that is not a string', async () => {
    expect((await server.put<ErrorResponse>('/variables', { variables: { PORT: 8080 } })).status).toBe(400);
  });
});

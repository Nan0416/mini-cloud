import { ErrorResponse, ListAgentsResponse, ListHealthChecksResponse, TaskAgent } from '@mini-cloud/shared';
import { TaskDispatcher } from '../../src/facades/task-dispatcher';
import { AgentEndpoints } from '../../src/routes/agent-endpoints';
import { AgentService } from '../../src/services/agent-service';
import { TaskService } from '../../src/services/task-service';
import { FakeAgentCommander, FakeAgentDao, FakeTaskDao, FakeTaskDynamicsDao, FakeTaskEventDao, FakeTaskInstanceDao, FakeVariableDao, NOW, aService } from '../data/fake-daos';
import { TestServer } from './test-helpers';

const context = () => {
  const taskDao = new FakeTaskDao();
  const taskDynamicsDao = new FakeTaskDynamicsDao();
  const taskInstanceDao = new FakeTaskInstanceDao();
  const taskEventDao = new FakeTaskEventDao();
  const variableDao = new FakeVariableDao();
  const agentDao = new FakeAgentDao();
  const agentCommander = new FakeAgentCommander();
  const taskDispatcher = new TaskDispatcher({ taskInstanceDao, taskEventDao, agentCommander });
  const taskService = new TaskService({ taskDao, taskDynamicsDao, taskInstanceDao, taskEventDao, variableDao, agentCommander, taskDispatcher });
  const agentService = new AgentService({ agentDao, agentCommander });
  return { taskDao, taskInstanceDao, taskEventDao, agentDao, agentCommander, taskService, agentService };
};

let fakes: ReturnType<typeof context>;
let server: TestServer;

beforeEach(async () => {
  fakes = context();
  server = await TestServer.start(new AgentEndpoints({ agentService: fakes.agentService, taskService: fakes.taskService }));
});

afterEach(async () => {
  await server.close();
});

const anInstance = (overrides: Record<string, unknown> = {}) => ({
  instanceId: 'i1',
  taskId: 't1',
  taskVersion: 1,
  agentId: 'mac-mini',
  status: 'launched' as const,
  createdAt: NOW,
  lastUpdatedAt: NOW,
  ...overrides,
});

describe('POST /agent-api/heartbeat', () => {
  it('registers an agent on its first heartbeat', async () => {
    const response = await server.post('/agent-api/heartbeat', { agentId: 'mac-mini', name: 'Mac mini' });

    expect(response.status).toBe(200);
    expect(fakes.agentDao.agents.get('mac-mini')).toMatchObject({ status: 'online' });
  });

  it('answers 400 for a heartbeat missing its name', async () => {
    const response = await server.post<ErrorResponse>('/agent-api/heartbeat', { agentId: 'mac-mini' });

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('INVALID_REQUEST');
  });
});

/**
 * Agent traffic is HTTP even though commands travel the other way over WebSocket: a
 * report needs an acknowledgement and a retryable failure, which request/response
 * gives for free and a fire-and-forget publish does not. These check the two halves
 * of that — a 200 an agent can stop retrying on, and a 4xx it should not retry.
 */
describe('POST /agent-api/instance-status', () => {
  it('applies a reported status', async () => {
    fakes.taskInstanceDao.seed(anInstance());

    const response = await server.post('/agent-api/instance-status', { instanceId: 'i1', status: 'running' });

    expect(response.status).toBe(200);
    expect(fakes.taskInstanceDao.statusOf('i1')).toBe('running');
  });

  it('acknowledges a stale report rather than making the agent retry it', async () => {
    fakes.taskInstanceDao.seed(anInstance({ status: 'exit_success' }));

    const response = await server.post('/agent-api/instance-status', { instanceId: 'i1', status: 'running' });

    // The report lost a race, which is normal traffic. A 4xx here would have the
    // agent retry something that can never be applied.
    expect(response.status).toBe(200);
    expect(fakes.taskInstanceDao.statusOf('i1')).toBe('exit_success');
  });

  it('answers 404 for an instance that no longer exists', async () => {
    expect((await server.post('/agent-api/instance-status', { instanceId: 'gone', status: 'running' })).status).toBe(404);
  });

  it('answers 400 for a status the agent is not allowed to report', async () => {
    fakes.taskInstanceDao.seed(anInstance());

    const response = await server.post<ErrorResponse>('/agent-api/instance-status', { instanceId: 'i1', status: 'initiated' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/status must be one of/);
  });
});

describe('POST /agent-api/instance-pid', () => {
  it('records the pid a task reported for itself', async () => {
    fakes.taskInstanceDao.seed(anInstance());

    expect((await server.post('/agent-api/instance-pid', { instanceId: 'i1', pid: 4211 })).status).toBe(200);
    expect(fakes.taskInstanceDao.instances.get('i1')?.pid).toBe(4211);
  });

  it('answers 400 for a pid no process can have', async () => {
    expect((await server.post('/agent-api/instance-pid', { instanceId: 'i1', pid: 0 })).status).toBe(400);
  });

  it('answers 404 for an instance that no longer exists', async () => {
    expect((await server.post('/agent-api/instance-pid', { instanceId: 'gone', pid: 4211 })).status).toBe(404);
  });
});

describe('POST /agent-api/instance-event', () => {
  it('records an event with the payload intact', async () => {
    const response = await server.post('/agent-api/instance-event', {
      instanceId: 'i1',
      source: 'task',
      level: 'error',
      payload: { code: 1, message: 'failed' },
      timestamp: NOW,
    });

    expect(response.status).toBe(200);
    expect(fakes.taskEventDao.events[0]).toMatchObject({ instanceId: 'i1', payload: { code: 1, message: 'failed' } });
  });

  it('refuses an event claiming to come from the service', async () => {
    const response = await server.post<ErrorResponse>('/agent-api/instance-event', {
      instanceId: 'i1',
      source: 'service',
      level: 'error',
      payload: 'x',
      timestamp: NOW,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('source must be one of [agent, task]');
  });
});

describe('POST /agent-api/health-checks', () => {
  it('answers with the checks for the versions an agent still hosts', async () => {
    fakes.taskDao.seed(aService({ taskId: 's1', version: 1, healthCheck: { type: 'passive' } }));

    const response = await server.post<ListHealthChecksResponse>('/agent-api/health-checks', { taskIdentifiers: [{ taskId: 's1', version: 1 }] });

    // An agent that restarts asks this so it can resume checking without waiting for
    // a relaunch.
    expect(response.status).toBe(200);
    expect(response.body.healthChecks).toEqual([{ taskId: 's1', version: 1, healthCheck: { type: 'passive' } }]);
  });

  it('answers with an empty list rather than failing when none have checks', async () => {
    const response = await server.post<ListHealthChecksResponse>('/agent-api/health-checks', { taskIdentifiers: [] });

    expect(response.status).toBe(200);
    expect(response.body.healthChecks).toEqual([]);
  });

  it('answers 400 for a malformed identifier, naming which one', async () => {
    const response = await server.post<ErrorResponse>('/agent-api/health-checks', { taskIdentifiers: [{ taskId: 's1' }] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('taskIdentifiers[0].version must be a number');
  });
});

describe('fleet routes', () => {
  const anAgent = (overrides: Partial<TaskAgent> = {}): TaskAgent => ({
    agentId: 'mac-mini',
    name: 'Mac mini',
    status: 'online',
    lastSeenAt: NOW,
    registeredAt: NOW,
    ...overrides,
  });

  it('lists the fleet', async () => {
    fakes.agentDao.seed(anAgent({ agentId: 'a', name: 'A' }), anAgent({ agentId: 'b', name: 'B', status: 'offline' }));

    const response = await server.get<ListAgentsResponse>('/agents');

    expect(response.status).toBe(200);
    expect(response.body.agents.map((agent) => agent.agentId)).toEqual(['a', 'b']);
  });

  it('terminates an agent named in the path', async () => {
    fakes.agentDao.seed(anAgent());
    fakes.agentCommander.connect('mac-mini');

    const response = await server.post('/agents/mac-mini/terminate');

    expect(response.status).toBe(200);
    expect(fakes.agentCommander.sent).toEqual([{ agentId: 'mac-mini', command: { type: 'terminate-agent' } }]);
  });

  it('answers 404 for an agent that was never registered', async () => {
    const response = await server.post<ErrorResponse>('/agents/nobody/terminate');

    expect(response.status).toBe(404);
    expect(response.body.errorCode).toBe('NOT_FOUND');
  });
});

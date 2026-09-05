import { ErrorResponse, ListAgentsResponse, TaskAgent } from '@mini-cloud/shared';
import { AgentEndpoints } from '../../src/routes/agent-endpoints';
import { AgentService } from '../../src/services/agent-service';
import { FakeAgentCommander, FakeAgentDao, NOW } from '../data/fake-daos';
import { TestServer } from './test-helpers';

/**
 * The operator's view of the fleet, which is all this class serves now: what agents
 * report in through lives on the internal listener, in `AgentReportEndpoints`.
 */
const context = () => {
  const agentDao = new FakeAgentDao();
  const agentCommander = new FakeAgentCommander();
  const agentService = new AgentService({ agentDao, agentCommander });
  return { agentDao, agentCommander, agentService };
};

let fakes: ReturnType<typeof context>;
let server: TestServer;

beforeEach(async () => {
  fakes = context();
  server = await TestServer.start(new AgentEndpoints({ agentService: fakes.agentService }));
});

afterEach(async () => {
  await server.close();
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

import { NotFoundError, TaskAgent } from '@mini-cloud/shared';
import { AgentService } from '../../src/services/agent-service';
import { FakeAgentCommander, FakeAgentDao, NOW } from '../data/fake-daos';

const anAgent = (overrides: Partial<TaskAgent> = {}): TaskAgent => ({
  agentId: 'mac-mini',
  name: 'Mac mini',
  status: 'online',
  lastSeenAt: NOW,
  registeredAt: NOW,
  ...overrides,
});

const build = () => {
  const agentDao = new FakeAgentDao();
  const agentCommander = new FakeAgentCommander();
  return { agentDao, agentCommander, service: new AgentService({ agentDao, agentCommander }) };
};

describe('AgentService.recordHeartbeat', () => {
  it('registers an agent nobody configured, on its first heartbeat', async () => {
    const { agentDao, service } = build();

    await service.recordHeartbeat({ agentId: 'mac-mini', name: 'Mac mini' });

    // Self-registration is what lets a machine join the fleet without a service
    // restart or a config edit.
    expect(agentDao.agents.get('mac-mini')).toMatchObject({ agentId: 'mac-mini', name: 'Mac mini', status: 'online' });
  });

  it('brings a known agent back online', async () => {
    const { agentDao, service } = build();
    agentDao.seed(anAgent({ status: 'offline' }));

    await service.recordHeartbeat({ agentId: 'mac-mini', name: 'Mac mini' });

    expect(agentDao.agents.get('mac-mini')?.status).toBe('online');
  });

  it('takes the name from the heartbeat, so renaming a machine propagates', async () => {
    const { agentDao, service } = build();
    agentDao.seed(anAgent({ name: 'Old name' }));

    await service.recordHeartbeat({ agentId: 'mac-mini', name: 'New name' });

    expect(agentDao.agents.get('mac-mini')?.name).toBe('New name');
  });

  it('keeps the original registration time across a restart', async () => {
    const { agentDao, service } = build();
    agentDao.seed(anAgent({ registeredAt: NOW - 86_400_000 }));

    await service.recordHeartbeat({ agentId: 'mac-mini', name: 'Mac mini' });

    // "Registered at" answers how long this machine has been part of the fleet; an
    // upsert that reset it would make every restart look like a new agent.
    expect(agentDao.agents.get('mac-mini')?.registeredAt).toBe(NOW - 86_400_000);
  });
});

describe('AgentService.listAgents', () => {
  it('returns the whole fleet, offline agents included', async () => {
    const { agentDao, service } = build();
    agentDao.seed(anAgent({ agentId: 'a', name: 'A' }), anAgent({ agentId: 'b', name: 'B', status: 'offline' }));

    const { agents } = await service.listAgents({});

    // An offline agent is still a fleet member, and hiding it would make a machine
    // that stopped heartbeating look deliberately removed.
    expect(agents.map((agent) => agent.agentId)).toEqual(['a', 'b']);
  });

  it('returns an empty fleet rather than failing', async () => {
    const { service } = build();

    expect((await service.listAgents({})).agents).toEqual([]);
  });
});

describe('AgentService.terminateAgent', () => {
  it('sends the shutdown command and marks the agent offline', async () => {
    const { agentDao, agentCommander, service } = build();
    agentDao.seed(anAgent());
    agentCommander.connect('mac-mini');

    await service.terminateAgent({ agentId: 'mac-mini' });

    expect(agentCommander.sent).toEqual([{ agentId: 'mac-mini', command: { type: 'terminate-agent' } }]);
    expect(agentDao.agents.get('mac-mini')?.status).toBe('offline');
  });

  it('still marks a disconnected agent offline, rather than failing', async () => {
    const { agentDao, service } = build();
    agentDao.seed(anAgent());

    // Nothing is connected, so the command reaches nobody. The operator's intent was
    // "this agent is gone", and refusing would leave it showing as online forever.
    await expect(service.terminateAgent({ agentId: 'mac-mini' })).resolves.toEqual({});
    expect(agentDao.agents.get('mac-mini')?.status).toBe('offline');
  });

  it('rejects an agent that was never registered', async () => {
    const { service } = build();

    await expect(service.terminateAgent({ agentId: 'nobody' })).rejects.toThrow(NotFoundError);
    await expect(service.terminateAgent({ agentId: 'nobody' })).rejects.toThrow('Agent nobody is not registered.');
  });

  it('sends nothing when the agent does not exist', async () => {
    const { agentCommander, service } = build();

    await expect(service.terminateAgent({ agentId: 'nobody' })).rejects.toThrow(NotFoundError);

    // The existence check comes first, so a typo does not broadcast a shutdown.
    expect(agentCommander.sent).toEqual([]);
  });

  it('is idempotent for an agent that is already offline', async () => {
    const { agentDao, service } = build();
    agentDao.seed(anAgent({ status: 'offline' }));

    await expect(service.terminateAgent({ agentId: 'mac-mini' })).resolves.toEqual({});
    expect(agentDao.agents.get('mac-mini')?.status).toBe('offline');
  });
});

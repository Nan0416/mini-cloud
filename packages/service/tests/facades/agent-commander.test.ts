import { AGENT_BROADCAST_TOPIC, HubStatus, LaunchInstruction, Target, agentTopic } from '@mini-cloud/shared';
import { HubAgentCommander } from '../../src/facades/agent-commander';
import { MessageHub, OutboundMessage } from '../../src/facades/message-hub';

/** Records what was published and reports a configurable delivery count. */
class FakeHub implements MessageHub {
  readonly published: Array<{ target: Target; message: OutboundMessage }> = [];
  deliveredTo = 1;

  publish(target: Target, message: OutboundMessage): number {
    this.published.push({ target, message });
    return this.deliveredTo;
  }

  getStatus(): HubStatus {
    return { subscriberCount: 0, topicToSubscriberCount: {} };
  }

  async terminate(): Promise<void> {}

  /** The single message published, failing loudly if that is not what happened. */
  get only(): { target: Target; message: OutboundMessage } {
    expect(this.published).toHaveLength(1);
    return this.published[0] as { target: Target; message: OutboundMessage };
  }
}

const instruction: LaunchInstruction = {
  taskId: 't1',
  version: 2,
  instanceId: 'i1',
  cmd: 'backup.sh',
  cwd: '/srv',
};

describe('HubAgentCommander addressing', () => {
  it("sends a launch to that agent's own topic, not to the whole fleet", () => {
    const hub = new FakeHub();

    new HubAgentCommander(hub).launchInstance('mac-mini', instruction);

    // The earlier design broadcast every launch to every agent and had each one
    // discard what was addressed to someone else; one machine's launch woke all of them.
    expect(hub.only.target).toEqual({ method: 'broadcast', to: agentTopic('mac-mini') });
    expect(hub.only.target.to).toBe('mini-cloud.agent.mac-mini');
  });

  it('addresses a terminate to the agent holding the process', () => {
    const hub = new FakeHub();

    new HubAgentCommander(hub).terminateInstance('mac-mini', 'i1', 4211);

    expect(hub.only.target).toEqual({ method: 'broadcast', to: agentTopic('mac-mini') });
    expect(hub.only.message.payload).toEqual({ type: 'terminate-instance', instanceId: 'i1', pid: 4211 });
  });

  it('addresses a shutdown to that one agent', () => {
    const hub = new FakeHub();

    new HubAgentCommander(hub).terminateAgent('mac-mini');

    expect(hub.only.target).toEqual({ method: 'broadcast', to: agentTopic('mac-mini') });
    expect(hub.only.message.payload).toEqual({ type: 'terminate-agent' });
  });

  it('sends a heartbeat probe to the fleet topic, which is the one thing that is fleet-wide', () => {
    const hub = new FakeHub();

    new HubAgentCommander(hub).requestHeartbeat();

    expect(hub.only.target).toEqual({ method: 'broadcast', to: AGENT_BROADCAST_TOPIC });
    expect(hub.only.message.payload).toEqual({ type: 'request-heartbeat' });
  });

  it("keeps two agents' topics distinct", () => {
    const hub = new FakeHub();
    const commander = new HubAgentCommander(hub);

    commander.launchInstance('a', instruction);
    commander.launchInstance('b', instruction);

    expect(hub.published.map((entry) => entry.target.to)).toEqual(['mini-cloud.agent.a', 'mini-cloud.agent.b']);
  });
});

describe('HubAgentCommander payloads', () => {
  it('carries the launch instruction through untouched', () => {
    const hub = new FakeHub();

    new HubAgentCommander(hub).launchInstance('mac-mini', instruction);

    expect(hub.only.message.payload).toEqual({ type: 'launch-instance', instruction });
  });

  it('stamps a publish time, so the agent can measure transit', () => {
    const hub = new FakeHub();
    const before = Date.now();

    new HubAgentCommander(hub).launchInstance('mac-mini', instruction);

    expect(hub.only.message.publishedAt).toBeGreaterThanOrEqual(before);
    expect(hub.only.message.publishedAt).toBeLessThanOrEqual(Date.now());
  });

  it('publishes anonymously, since the service holds no subscriber connection', () => {
    const hub = new FakeHub();

    new HubAgentCommander(hub).launchInstance('mac-mini', instruction);

    expect(hub.only.message.senderId).toBeUndefined();
  });
});

/**
 * The delivery count is the point of returning a number at all: publishing reports
 * how many subscribers received the message, which is a more current answer than the
 * heartbeat table — that can be up to one expiry window stale.
 */
describe('HubAgentCommander delivery counts', () => {
  it('reports how many connections the command reached', () => {
    const hub = new FakeHub();
    hub.deliveredTo = 2;

    expect(new HubAgentCommander(hub).launchInstance('mac-mini', instruction)).toBe(2);
  });

  it('reports zero for an agent that is not connected', () => {
    const hub = new FakeHub();
    hub.deliveredTo = 0;
    const commander = new HubAgentCommander(hub);

    // Callers branch on this to decide between `initiated` and `initiation_failed`,
    // so a truthy-but-wrong value here would report a launch that never happened.
    expect(commander.launchInstance('mac-mini', instruction)).toBe(0);
    expect(commander.terminateInstance('mac-mini', 'i1', 4211)).toBe(0);
    expect(commander.terminateAgent('mac-mini')).toBe(0);
  });

  it('reports how many agents a heartbeat probe reached', () => {
    const hub = new FakeHub();
    hub.deliveredTo = 3;

    expect(new HubAgentCommander(hub).requestHeartbeat()).toBe(3);
  });
});

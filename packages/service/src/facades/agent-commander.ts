import { AGENT_BROADCAST_TOPIC, AgentCommand, LaunchInstruction, LoggerFactory, agentTopic } from '@mini-cloud/shared';
import { MessageHub } from './message-hub';

const logger = LoggerFactory.getLogger('AgentCommander');

export interface AgentCommander {
  /** Returns the number of agent connections the command reached — 0 means offline. */
  launchInstance(agentId: string, instruction: LaunchInstruction): number;
  terminateInstance(agentId: string, instanceId: string, pid: number): number;
  terminateAgent(agentId: string): number;
  /** Fleet-wide liveness probe. Returns how many agents were reached. */
  requestHeartbeat(): number;
}

/**
 * Sends commands to agents over the pub/sub hub.
 *
 * Targeted commands go to that agent's own topic, so launching on one machine does
 * not wake the rest of the fleet. Because publishing reports how many subscribers
 * received the message, a delivery count of zero is an immediate, authoritative
 * signal that the agent is disconnected — more current than the heartbeat table,
 * which can be up to one expiry window stale.
 */
export class HubAgentCommander implements AgentCommander {
  constructor(private readonly hub: MessageHub) {}

  launchInstance(agentId: string, instruction: LaunchInstruction): number {
    logger.info(`Commanding agent ${agentId} to launch instance ${instruction.instanceId} (task ${instruction.taskId} v${instruction.version}).`);
    return this.send(agentTopic(agentId), { type: 'launch-instance', instruction });
  }

  terminateInstance(agentId: string, instanceId: string, pid: number): number {
    logger.info(`Commanding agent ${agentId} to terminate instance ${instanceId} (pid ${pid}).`);
    return this.send(agentTopic(agentId), { type: 'terminate-instance', instanceId, pid });
  }

  terminateAgent(agentId: string): number {
    logger.info(`Commanding agent ${agentId} to shut down.`);
    return this.send(agentTopic(agentId), { type: 'terminate-agent' });
  }

  requestHeartbeat(): number {
    return this.send(AGENT_BROADCAST_TOPIC, { type: 'request-heartbeat' });
  }

  private send(topic: string, command: AgentCommand): number {
    // The service is on the same process as the hub, so "published" and "sent" are
    // the same instant; stamping here still gives the agent a real transit time.
    return this.hub.publish({ method: 'broadcast', to: topic }, { payload: command, publishedAt: Date.now() });
  }
}

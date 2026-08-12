import { LoggerFactory, NotFoundError, TaskAgent } from '@mini-cloud/shared';
import { AgentDao } from '../data/agent-dao';
import { AgentCommander } from '../facades/agent-commander';

const logger = LoggerFactory.getLogger('AgentService');

export interface AgentServiceProps {
  readonly agentDao: AgentDao;
  readonly agentCommander: AgentCommander;
}

/** Agent registration, liveness and shutdown. */
export class AgentService {
  private readonly agentDao: AgentDao;
  private readonly agentCommander: AgentCommander;

  constructor(props: AgentServiceProps) {
    this.agentDao = props.agentDao;
    this.agentCommander = props.agentCommander;
  }

  /** First heartbeat registers the agent; later ones just refresh its liveness. */
  async recordHeartbeat(agentId: string, name: string): Promise<TaskAgent> {
    const existing = await this.agentDao.getAgent(agentId);
    const agent = await this.agentDao.recordHeartbeat(agentId, name);
    if (existing === null) {
      logger.info(`Registered new agent ${agentId} ("${name}").`);
    } else if (existing.status === 'offline') {
      logger.info(`Agent ${agentId} ("${name}") is back online.`);
    }
    return agent;
  }

  async listAgents(): Promise<ReadonlyArray<TaskAgent>> {
    return this.agentDao.listAgents();
  }

  async getAgent(agentId: string): Promise<TaskAgent> {
    const agent = await this.agentDao.getAgent(agentId);
    if (agent === null) {
      throw new NotFoundError(`Agent ${agentId} is not registered.`);
    }
    return agent;
  }

  async terminateAgent(agentId: string): Promise<void> {
    const agent = await this.getAgent(agentId);
    const delivered = this.agentCommander.terminateAgent(agentId);
    if (delivered === 0) {
      logger.info(`Agent ${agentId} ("${agent.name}") is not connected; marking it offline without sending a shutdown command.`);
    }
    await this.agentDao.setStatus(agentId, 'offline');
  }

  /** Marks agents that stopped heartbeating as offline. Returns the ones it changed. */
  async expireAgents(unseenSince: number): Promise<ReadonlyArray<TaskAgent>> {
    const expired = await this.agentDao.expireAgents(unseenSince);
    for (const agent of expired) {
      logger.warn(`Agent ${agent.agentId} ("${agent.name}") stopped heartbeating; marked offline.`);
    }
    return expired;
  }
}

import {
  HeartbeatRequest,
  HeartbeatResponse,
  ListAgentsRequest,
  ListAgentsResponse,
  LoggerFactory,
  NotFoundError,
  TaskAgent,
  TerminateAgentRequest,
  TerminateAgentResponse,
} from '@mini-cloud/shared';
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
  async recordHeartbeat(request: HeartbeatRequest): Promise<HeartbeatResponse> {
    const { agentId, name } = request;
    const existing = await this.agentDao.getAgent(agentId);
    await this.agentDao.recordHeartbeat(agentId, name);
    if (existing === null) {
      logger.info(`Registered new agent ${agentId} ("${name}").`);
    } else if (existing.status === 'offline') {
      logger.info(`Agent ${agentId} ("${name}") is back online.`);
    }
    return {};
  }

  async listAgents(_request: ListAgentsRequest = {}): Promise<ListAgentsResponse> {
    return { agents: await this.agentDao.listAgents() };
  }

  async terminateAgent(request: TerminateAgentRequest): Promise<TerminateAgentResponse> {
    const { agentId } = request;
    const agent = await this.requireAgent(agentId);
    const delivered = this.agentCommander.terminateAgent(agentId);
    if (delivered === 0) {
      logger.info(`Agent ${agentId} ("${agent.name}") is not connected; marking it offline without sending a shutdown command.`);
    }
    await this.agentDao.setStatus(agentId, 'offline');
    return {};
  }

  private async requireAgent(agentId: string): Promise<TaskAgent> {
    const agent = await this.agentDao.getAgent(agentId);
    if (agent === null) {
      throw new NotFoundError(`Agent ${agentId} is not registered.`);
    }
    return agent;
  }
}

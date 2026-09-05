import { ListAgentsResponse, LoggerFactory, TerminateAgentResponse } from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { AgentService } from '../services/agent-service';
import { Endpoints } from './endpoints';

const logger = LoggerFactory.getLogger('AgentEndpoints');

export interface AgentEndpointsProps {
  readonly agentService: AgentService;
}

/**
 * The operator's view of the fleet: which machines are registered, and standing one
 * down. Served by the public listener, next to tasks and instances, because the
 * callers are the console and the CLI rather than the agents themselves — those
 * report in through `AgentReportEndpoints` on the internal listener.
 */
export class AgentEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: AgentEndpointsProps) {
    const { agentService } = props;
    this.router = Router();

    this.router.get('/agents', async (_req, res) => {
      const response: ListAgentsResponse = await agentService.listAgents({});
      res.status(200).json(response);
    });

    this.router.post('/agents/:agentId/terminate', async (req, res) => {
      logger.info(`Terminate agent ${req.params.agentId}.`);
      const response: TerminateAgentResponse = await agentService.terminateAgent({ agentId: req.params.agentId });
      res.status(200).json(response);
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}

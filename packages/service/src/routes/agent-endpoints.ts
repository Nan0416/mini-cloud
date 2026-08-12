import {
  HeartbeatResponse,
  ListAgentsResponse,
  ListHealthChecksResponse,
  LoggerFactory,
  ReportInstancePidResponse,
  ReportInstanceStatusResponse,
  ReportTaskEventResponse,
  TerminateAgentResponse,
} from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { AgentService } from '../services/agent-service';
import { InstanceService } from '../services/instance-service';
import { TaskService } from '../services/task-service';
import {
  parseHeartbeatRequest,
  parseListHealthChecksRequest,
  parseReportInstancePidRequest,
  parseReportInstanceStatusRequest,
  parseReportTaskEventRequest,
} from '../utils/request-parsing';
import { Endpoints } from './endpoints';

const logger = LoggerFactory.getLogger('AgentEndpoints');

export interface AgentEndpointsProps {
  readonly agentService: AgentService;
  readonly instanceService: InstanceService;
  readonly taskService: TaskService;
}

/**
 * Routes agents call, plus the operator-facing view of the fleet.
 *
 * Agent traffic is HTTP even though commands travel the other way over WebSocket: a
 * report needs an acknowledgement and a retryable failure, which request/response
 * gives for free and a fire-and-forget publish does not.
 */
export class AgentEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: AgentEndpointsProps) {
    const { agentService, instanceService, taskService } = props;
    this.router = Router();

    this.router.post('/agent-api/heartbeat', async (req, res) => {
      const request = parseHeartbeatRequest(req.body);
      await agentService.recordHeartbeat(request.agentId, request.name);
      const response: HeartbeatResponse = {};
      res.status(200).json(response);
    });

    this.router.post('/agent-api/instance-status', async (req, res) => {
      const request = parseReportInstanceStatusRequest(req.body);
      logger.info(`Agent reports instance ${request.instanceId} is "${request.status}".`);
      await instanceService.recordStatus(request.instanceId, request.status);
      const response: ReportInstanceStatusResponse = {};
      res.status(200).json(response);
    });

    this.router.post('/agent-api/instance-pid', async (req, res) => {
      const request = parseReportInstancePidRequest(req.body);
      await instanceService.recordPid(request.instanceId, request.pid);
      const response: ReportInstancePidResponse = {};
      res.status(200).json(response);
    });

    this.router.post('/agent-api/instance-event', async (req, res) => {
      const request = parseReportTaskEventRequest(req.body);
      await instanceService.addEvent(request);
      const response: ReportTaskEventResponse = {};
      res.status(200).json(response);
    });

    /**
     * An agent that restarts asks which of the instances it is still hosting have
     * health checks, so it can resume checking them without waiting for a relaunch.
     */
    this.router.post('/agent-api/health-checks', async (req, res) => {
      const request = parseListHealthChecksRequest(req.body);
      const response: ListHealthChecksResponse = { healthChecks: await taskService.listHealthChecks(request.taskIdentifiers) };
      res.status(200).json(response);
    });

    this.router.get('/agents', async (_req, res) => {
      const response: ListAgentsResponse = { agents: await agentService.listAgents() };
      res.status(200).json(response);
    });

    this.router.post('/agents/:agentId/terminate', async (req, res) => {
      logger.info(`Terminate agent ${req.params.agentId}.`);
      await agentService.terminateAgent(req.params.agentId);
      const response: TerminateAgentResponse = {};
      res.status(200).json(response);
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}

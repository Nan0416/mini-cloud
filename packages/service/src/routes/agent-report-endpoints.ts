import {
  HeartbeatResponse,
  ListAgentInstancesResponse,
  ListHealthChecksResponse,
  LoggerFactory,
  ReportInstancePidResponse,
  ReportInstanceStatusResponse,
  ReportTaskEventResponse,
} from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { AgentService } from '../services/agent-service';
import { TaskService } from '../services/task-service';
import {
  parseHeartbeatRequest,
  parseListAgentInstancesRequest,
  parseListHealthChecksRequest,
  parseReportInstancePidRequest,
  parseReportInstanceStatusRequest,
  parseReportTaskEventRequest,
} from '../utils/request-parsing';
import { Endpoints } from './endpoints';

const logger = LoggerFactory.getLogger('AgentReportEndpoints');

export interface AgentReportEndpointsProps {
  readonly agentService: AgentService;
  readonly taskService: TaskService;
}

/**
 * What agents call to report in. Bound to the internal listener only, alongside the
 * hub — an agent never talks to the public one.
 *
 * Separate from `AgentEndpoints`, which serves the operator's view of the same
 * fleet, because the split is by *who calls*, and that is what decides which listener
 * a route appears on. Holding both in one class meant a single `bind` could only ever
 * put agent-facing routes on the internet-facing port.
 *
 * Agent traffic is HTTP even though commands travel the other way over WebSocket: a
 * report needs an acknowledgement and a retryable failure, which request/response
 * gives for free and a fire-and-forget publish does not.
 */
export class AgentReportEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: AgentReportEndpointsProps) {
    const { agentService, taskService } = props;
    this.router = Router();

    this.router.post('/agent-api/heartbeat', async (req, res) => {
      const request = parseHeartbeatRequest(req.body);
      const response: HeartbeatResponse = await agentService.recordHeartbeat(request);
      res.status(200).json(response);
    });

    this.router.post('/agent-api/instance-status', async (req, res) => {
      const request = parseReportInstanceStatusRequest(req.body);
      logger.info(`Agent reports instance ${request.instanceId} is "${request.status}".`);
      const response: ReportInstanceStatusResponse = await taskService.recordStatus(request);
      res.status(200).json(response);
    });

    this.router.post('/agent-api/instance-pid', async (req, res) => {
      const request = parseReportInstancePidRequest(req.body);
      const response: ReportInstancePidResponse = await taskService.recordPid(request);
      res.status(200).json(response);
    });

    this.router.post('/agent-api/instance-event', async (req, res) => {
      const request = parseReportTaskEventRequest(req.body);
      const response: ReportTaskEventResponse = await taskService.addEvent(request);
      res.status(200).json(response);
    });

    /**
     * An agent that restarts has forgotten what it was supervising, while the tasks
     * themselves are still running — they were spawned detached. This is the first
     * half of recovering that: which instances does the service think are ours?
     *
     * The operator's `GET /instances` answers the same question with a far wider
     * query surface, and it lives on the public listener. An agent must not have to
     * reach across for this, so the agent plane has its own narrower route.
     */
    this.router.post('/agent-api/instances', async (req, res) => {
      const request = parseListAgentInstancesRequest(req.body);
      const response: ListAgentInstancesResponse = await taskService.listInstances(request);
      res.status(200).json(response);
    });

    /**
     * The second half: which of those have health checks, so supervision can resume
     * without waiting for a relaunch.
     */
    this.router.post('/agent-api/health-checks', async (req, res) => {
      const request = parseListHealthChecksRequest(req.body);
      const response: ListHealthChecksResponse = await taskService.listHealthChecks(request);
      res.status(200).json(response);
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}

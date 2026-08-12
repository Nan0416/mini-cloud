import {
  CreateTaskResponse,
  DeleteTaskResponse,
  GetTaskDynamicsResponse,
  GetTaskInstanceResponse,
  GetTaskResponse,
  LaunchTaskResponse,
  ListReplacementVariablesResponse,
  ListTaskEventsResponse,
  ListTaskInstancesResponse,
  ListTasksResponse,
  LoggerFactory,
  SetReplacementVariablesResponse,
  SetTaskActiveResponse,
  SetTaskTargetAgentsResponse,
  TerminateTaskInstanceResponse,
  UpdateTaskResponse,
  assertRecord,
} from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { InstanceService } from '../services/instance-service';
import { LaunchService } from '../services/launch-service';
import { TaskService } from '../services/task-service';
import {
  optionalLimitParam,
  optionalVersionParam,
  parseCreateTaskRequest,
  parseLaunchTaskRequest,
  parseListTaskInstancesQuery,
  parseSetReplacementVariablesRequest,
  parseSetTaskActiveRequest,
  parseSetTaskTargetAgentsRequest,
  parseUpdateTaskRequest,
} from '../utils/request-parsing';
import { Endpoints } from './endpoints';

const logger = LoggerFactory.getLogger('TaskEndpoints');

export interface TaskEndpointsProps {
  readonly taskService: TaskService;
  readonly instanceService: InstanceService;
  readonly launchService: LaunchService;
}

/**
 * Operator-facing routes: managing task definitions, launching them and reading back
 * what happened.
 *
 * Resource ids live in the path; the rest of each request is the body. Handlers are
 * async and simply throw — Express 5 forwards a rejected promise to the error
 * handler, so there is no try/catch/next boilerplate here.
 */
export class TaskEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: TaskEndpointsProps) {
    const { taskService, instanceService, launchService } = props;
    this.router = Router();

    this.router.post('/tasks', async (req, res) => {
      const request = parseCreateTaskRequest(req.body);
      logger.info(`Create ${request.type} task "${request.name}".`);
      const response: CreateTaskResponse = await taskService.createTask(request);
      res.status(201).json(response);
    });

    this.router.get('/tasks', async (_req, res) => {
      const response: ListTasksResponse = { tasks: await taskService.listTasks() };
      res.status(200).json(response);
    });

    this.router.get('/tasks/:taskId', async (req, res) => {
      const version = optionalVersionParam(req.query);
      const response: GetTaskResponse = { task: await taskService.getTask(req.params.taskId, version) };
      res.status(200).json(response);
    });

    this.router.put('/tasks/:taskId', async (req, res) => {
      const request = parseUpdateTaskRequest({ ...assertRecord(req.body, 'body'), taskId: req.params.taskId });
      logger.info(`Update task ${request.taskId}.`);
      const response: UpdateTaskResponse = await taskService.updateTask(request);
      res.status(200).json(response);
    });

    this.router.delete('/tasks/:taskId', async (req, res) => {
      logger.info(`Delete task ${req.params.taskId}.`);
      await taskService.deleteTask(req.params.taskId);
      const response: DeleteTaskResponse = {};
      res.status(200).json(response);
    });

    this.router.get('/tasks/:taskId/dynamics', async (req, res) => {
      const response: GetTaskDynamicsResponse = { dynamics: await taskService.getDynamics(req.params.taskId) };
      res.status(200).json(response);
    });

    this.router.put('/tasks/:taskId/active', async (req, res) => {
      const request = parseSetTaskActiveRequest({ ...assertRecord(req.body, 'body'), taskId: req.params.taskId });
      const response: SetTaskActiveResponse = { dynamics: await taskService.setActive(request.taskId, request.active) };
      res.status(200).json(response);
    });

    this.router.put('/tasks/:taskId/target-agents', async (req, res) => {
      const request = parseSetTaskTargetAgentsRequest({ ...assertRecord(req.body, 'body'), taskId: req.params.taskId });
      const response: SetTaskTargetAgentsResponse = { dynamics: await taskService.setTargetAgents(request.taskId, request.targetAgentIds) };
      res.status(200).json(response);
    });

    this.router.post('/tasks/:taskId/launch', async (req, res) => {
      const request = parseLaunchTaskRequest({ ...assertRecord(req.body, 'body'), taskId: req.params.taskId });
      logger.info(`Launch task ${request.taskId}.`);
      const response: LaunchTaskResponse = { results: await launchService.launchTask(request.taskId, request.targetAgentIds, request.arguments) };
      res.status(200).json(response);
    });

    this.router.get('/instances', async (req, res) => {
      const request = parseListTaskInstancesQuery(req.query);
      const response: ListTaskInstancesResponse = { instances: await instanceService.listInstances(request) };
      res.status(200).json(response);
    });

    this.router.get('/instances/:instanceId', async (req, res) => {
      const response: GetTaskInstanceResponse = { instance: await instanceService.getInstance(req.params.instanceId) };
      res.status(200).json(response);
    });

    this.router.post('/instances/:instanceId/terminate', async (req, res) => {
      logger.info(`Terminate instance ${req.params.instanceId}.`);
      await launchService.terminateInstance(req.params.instanceId);
      const response: TerminateTaskInstanceResponse = {};
      res.status(200).json(response);
    });

    this.router.get('/instances/:instanceId/events', async (req, res) => {
      const limit = optionalLimitParam(req.query);
      const response: ListTaskEventsResponse = { events: await instanceService.listEvents(req.params.instanceId, limit) };
      res.status(200).json(response);
    });

    this.router.get('/variables', async (_req, res) => {
      const response: ListReplacementVariablesResponse = { variables: await taskService.listVariables() };
      res.status(200).json(response);
    });

    this.router.put('/variables', async (req, res) => {
      const request = parseSetReplacementVariablesRequest(req.body);
      const response: SetReplacementVariablesResponse = { variables: await taskService.setVariables(request.variables) };
      res.status(200).json(response);
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}

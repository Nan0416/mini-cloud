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
}

/**
 * Operator-facing routes: managing task definitions, launching them and reading back
 * what happened.
 *
 * Resource ids live in the path; the rest of each request is the body. Handlers are
 * async and simply throw — Express 5 forwards a rejected promise to the error
 * handler, so there is no try/catch/next boilerplate here.
 *
 * Every service method takes one Request and returns one Response, so a handler's
 * whole job is parsing the former and choosing a status code for the latter.
 */
export class TaskEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: TaskEndpointsProps) {
    const { taskService } = props;
    this.router = Router();

    this.router.post('/tasks', async (req, res) => {
      const request = parseCreateTaskRequest(req.body);
      logger.info(`Create ${request.type} task "${request.name}".`);
      const response: CreateTaskResponse = await taskService.createTask(request);
      res.status(201).json(response);
    });

    this.router.get('/tasks', async (_req, res) => {
      const response: ListTasksResponse = await taskService.listTasks({});
      res.status(200).json(response);
    });

    this.router.get('/tasks/:taskId', async (req, res) => {
      const version = optionalVersionParam(req.query);
      const response: GetTaskResponse = await taskService.getTask({ taskId: req.params.taskId, version });
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
      const response: DeleteTaskResponse = await taskService.deleteTask({ taskId: req.params.taskId });
      res.status(200).json(response);
    });

    this.router.get('/tasks/:taskId/dynamics', async (req, res) => {
      const response: GetTaskDynamicsResponse = await taskService.getDynamics({ taskId: req.params.taskId });
      res.status(200).json(response);
    });

    this.router.put('/tasks/:taskId/active', async (req, res) => {
      const request = parseSetTaskActiveRequest({ ...assertRecord(req.body, 'body'), taskId: req.params.taskId });
      const response: SetTaskActiveResponse = await taskService.setActive(request);
      res.status(200).json(response);
    });

    this.router.put('/tasks/:taskId/target-agents', async (req, res) => {
      const request = parseSetTaskTargetAgentsRequest({ ...assertRecord(req.body, 'body'), taskId: req.params.taskId });
      const response: SetTaskTargetAgentsResponse = await taskService.setTargetAgents(request);
      res.status(200).json(response);
    });

    this.router.post('/tasks/:taskId/launch', async (req, res) => {
      const request = parseLaunchTaskRequest({ ...assertRecord(req.body, 'body'), taskId: req.params.taskId });
      logger.info(`Launch task ${request.taskId}.`);
      const response: LaunchTaskResponse = await taskService.launchTask(request);
      res.status(200).json(response);
    });

    this.router.get('/instances', async (req, res) => {
      const request = parseListTaskInstancesQuery(req.query);
      const response: ListTaskInstancesResponse = await taskService.listInstances(request);
      res.status(200).json(response);
    });

    this.router.get('/instances/:instanceId', async (req, res) => {
      const response: GetTaskInstanceResponse = await taskService.getInstance({ instanceId: req.params.instanceId });
      res.status(200).json(response);
    });

    this.router.post('/instances/:instanceId/terminate', async (req, res) => {
      logger.info(`Terminate instance ${req.params.instanceId}.`);
      const response: TerminateTaskInstanceResponse = await taskService.terminateInstance({ instanceId: req.params.instanceId });
      res.status(200).json(response);
    });

    this.router.get('/instances/:instanceId/events', async (req, res) => {
      const limit = optionalLimitParam(req.query);
      const response: ListTaskEventsResponse = await taskService.listEvents({ instanceId: req.params.instanceId, limit });
      res.status(200).json(response);
    });

    this.router.get('/variables', async (_req, res) => {
      const response: ListReplacementVariablesResponse = await taskService.listVariables({});
      res.status(200).json(response);
    });

    this.router.put('/variables', async (req, res) => {
      const request = parseSetReplacementVariablesRequest(req.body);
      const response: SetReplacementVariablesResponse = await taskService.setVariables(request);
      res.status(200).json(response);
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}

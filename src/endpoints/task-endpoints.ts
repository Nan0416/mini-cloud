import type { Express } from 'express';
import { LoggerFactory } from '@sparrow/logging-js';
import {
  assertCreateTaskRequest,
  assertLaunchTaskRequest,
  assertTerminateTaskInstanceRequest,
  assertUpdateTaskRequest,
  convertToGetTaskRequest,
  convertToListTaskEventsRequest,
  convertToListTaskInstancesRequest,
  assertTerminateTaskAgentRequest,
  assertResetReplacementVariablesRequest,
  assertListHealthChecksRequest,
  convertToGetTaskInstanceRequest,
  convertToGetTaskDynamicsRequest,
  assertResetTaskActiveRequest,
  assertResetTaskTargetAgentsRequest,
  assertReportTaskEventRequest,
  assertReportTaskInstancePidRequest,
  assertReportTaskInstanceStatusRequest,
  assertReportAgentStatusRequest,
  assertDeleteTaskRequest,
  assertListRunningInstancesRequest,
} from './task-request-assertions';
import { Endpoints } from './endpoints';
import { TaskHandler } from '../handlers/task-handler';

const logger = LoggerFactory.getLogger('TaskEndpoints');
export class TaskEndpoints implements Endpoints {
  private readonly taskHandler: TaskHandler;
  constructor(taskHandler: TaskHandler) {
    this.taskHandler = taskHandler;
  }

  bind(app: Express) {
    this.bindEndpointsForTaskAgent(app);
    this.bindEndpointsForService(app);
  }

  private bindEndpointsForTaskAgent(app: Express) {
    app.post('/task/instance-event', async (req, res, next) => {
      const request = req.body;
      logger.info('Received request to add new task event.');
      try {
        assertReportTaskEventRequest(request);
        logger.info(`Add new task event for instance ${request.taskInstanceId}.`);
        const response = await this.taskHandler.reportTaskEvent(request);
        res.status(200);
        res.json(response);
        return;
      } catch (err) {
        next(err);
      }
    });

    app.post('/task/instance-pid', async (req, res, next) => {
      const request = req.body;
      logger.info('Received request to set task instance pid.');
      try {
        assertReportTaskInstancePidRequest(request);
        logger.info(`Set instance ${request.taskInstanceId} pid to ${request.pid}.`);
        const response = await this.taskHandler.reportTaskInstancePid(request);
        res.status(200);
        res.json(response);
        return;
      } catch (err) {
        next(err);
      }
    });

    app.post('/task/instance-status', async (req, res, next) => {
      const request = req.body;
      logger.info('Received request to update task instance status.');
      try {
        assertReportTaskInstanceStatusRequest(request);
        logger.info(`Update instance ${request.taskInstanceId} status to ${request.status}.`);
        const response = await this.taskHandler.reportTaskInstanceStatus(request);
        res.status(200);
        res.json(response);
        return;
      } catch (err) {
        next(err);
      }
    });

    app.post('/task/agent-status', async (req, res, next) => {
      const request = req.body;
      // the message has a lot.
      logger.debug('Received request to report agent status.');
      try {
        assertReportAgentStatusRequest(request);
        logger.debug(`Agent ${request.agentId} ${request.name} report status.`);
        const response = await this.taskHandler.reportAgentStatus(request);
        res.status(200);
        res.json(response);
        return;
      } catch (err) {
        next(err);
      }
    });

    app.post('/task/health-checks', async (req, res, next) => {
      const request = req.body;
      logger.info('Received request to list health checks.');
      try {
        assertListHealthChecksRequest(request);
        logger.info(`List ${request.taskIdentifiers.length} health checks.`);
        const response = await this.taskHandler.listHealthChecks(request);
        res.status(200);
        res.json(response);
        return;
      } catch (err) {
        next(err);
      }
    });

    app.get('/task/running-task-instances', async (req, res, next) => {
      logger.info('received request to list task instances');
      try {
        const request = req.query as any;
        assertListRunningInstancesRequest(request);
        logger.info(`list running task instances with aegnt ${request.agentId}`);
        const response = await this.taskHandler.listRunningInstances(request);
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });
  }

  private bindEndpointsForService(app: Express) {
    app.post('/task/task', async (req, res, next) => {
      logger.info('Received request to create task.');
      const request = req.body;
      try {
        assertCreateTaskRequest(request);
        logger.info(`create task ${request.name} ${request.cmd}`);
        const response = await this.taskHandler.createTask(request);
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.put('/task/task', async (req, res, next) => {
      logger.info('received request to update task');
      const request = req.body;
      try {
        assertUpdateTaskRequest(request);
        logger.info(`update task ${request.taskId} ${request.name}`);
        const response = await this.taskHandler.updateTask(request);
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.delete('/task/task', async (req, res, next) => {
      logger.info('received request to delete task');
      const query = req.query as any;
      try {
        assertDeleteTaskRequest(query);
        logger.info(`delete task ${query.taskId}`);
        const response = await this.taskHandler.deleteTask(query);
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.get('/task/task', async (req, res, next) => {
      logger.info('received request to get task');
      try {
        const request = convertToGetTaskRequest(req.query);
        logger.info(`get task ${request.taskId} version ${request.version}`);
        const response = await this.taskHandler.getTask(request);
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.get('/task/tasks', async (req, res, next) => {
      logger.info('received request to list tasks');
      try {
        const response = await this.taskHandler.listTasks({});
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.get('/task/task-dynamics', async (req, res, next) => {
      logger.info('received request to get task dynamics');
      try {
        const request = convertToGetTaskDynamicsRequest(req.query);
        logger.info(`get task dynamics ${request.taskId}`);
        const response = await this.taskHandler.getTaskDynamics(request);
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.post('/task/task-active', async (req, res, next) => {
      logger.info('received request to reset task active');
      const request = req.body;
      try {
        assertResetTaskActiveRequest(request);
        logger.info(`reset task dynamics ${request.taskId} active to ${request.active}`);
        const response = await this.taskHandler.resetTaskActive(request);
        res.status(200);

        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.post('/task/task-target-agents', async (req, res, next) => {
      logger.info('received request to reset task target agents');
      const request = req.body;
      try {
        assertResetTaskTargetAgentsRequest(request);
        logger.info(`reset task dynamics ${request.taskId} target agents ${request.targetAgentIds.join(', ')}`);
        const response = await this.taskHandler.resetTaskTargetAgents(request);
        res.status(200);

        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.get('/task/task-instances', async (req, res, next) => {
      logger.info('received request to list task instances');
      try {
        const request = convertToListTaskInstancesRequest(req.query);
        logger.info(`list task instances with task ${request.taskId} version ${request.version} status ${request.status} from ${request.from} to ${request.to}`);
        const response = await this.taskHandler.listTaskInstances(request);
        res.status(200);

        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.get('/task/task-instance', async (req, res, next) => {
      logger.info('received request to get task instances');
      try {
        const request = convertToGetTaskInstanceRequest(req.query);
        logger.info(`get task instance with instance id ${request.taskInstanceId}`);
        const response = await this.taskHandler.getTaskInstance(request);

        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.get('/task/task-events', async (req, res, next) => {
      logger.info('received request to list task events');
      try {
        const request = convertToListTaskEventsRequest(req.query);
        logger.info(`list task events of task instance ${request.taskInstanceId}`);
        const response = await this.taskHandler.listTaskEvents(request);
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.post('/task/launch', async (req, res, next) => {
      logger.info('received request to launch task');
      const request = req.body;
      try {
        assertLaunchTaskRequest(request);
        logger.info(`launch task ${request.taskId}`);
        const response = await this.taskHandler.launchTask(request);

        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.post('/task/terminate-instance', async (req, res, next) => {
      logger.info('received request to terminate task instance');
      const request = req.body;
      try {
        assertTerminateTaskInstanceRequest(request);
        logger.info(`terminate task instance ${request.taskInstanceId}`);
        const response = await this.taskHandler.terminateTaskInstance(request);
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.get('/task/agents', async (req, res, next) => {
      logger.info('received request to list task agents');
      try {
        const response = await this.taskHandler.listTaskAgents({});

        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.post('/task/terminate-agent', async (req, res, next) => {
      logger.info('received request to launch task agent');
      const request = req.body;
      try {
        assertTerminateTaskAgentRequest(request);
        logger.info(`terminate task agent ${request.agentId}`);
        const response = await this.taskHandler.terminateTaskAgent(request);
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.get('/task/variables', async (req, res, next) => {
      logger.info('received request to list replacement variables');
      try {
        const response = await this.taskHandler.listReplacementVariables({});

        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });

    app.post('/task/variables', async (req, res, next) => {
      logger.info('received request to reset replacement variables');
      const request = req.body;
      try {
        assertResetReplacementVariablesRequest(request);
        const response = await this.taskHandler.resetReplacementVariables(request);
        res.status(200);
        res.json(response);
      } catch (err) {
        next(err);
      }
    });
  }
}

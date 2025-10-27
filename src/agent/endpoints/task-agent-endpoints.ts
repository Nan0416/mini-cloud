import { Express } from 'express';
import { LoggerFactory } from '@sparrow/logging-js';
import { Endpoints } from './endpoints';
import { TaskAgentHandler } from '../task-agent-core';
import { TaskAgentRequestAssertions } from './task-agent-request-assertions';

export interface TaskAgentServerProps {
  readonly port: number;
  readonly agentId: string;
}

const logger = LoggerFactory.getLogger('TaskAgentEndpoints');

export class TaskAgentEndpoints implements Endpoints {
  private readonly assertions: TaskAgentRequestAssertions;
  private readonly taskAgentHandler: TaskAgentHandler;

  constructor(taskAgentHandler: TaskAgentHandler) {
    this.assertions = new TaskAgentRequestAssertions();
    this.taskAgentHandler = taskAgentHandler;
  }

  bind(app: Express): void {
    app.post('/task-reporter/pid', async (req, res, next) => {
      try {
        const request = this.assertions.assert('ReportPidRequest', req.body);
        logger.info(`Received request to report task instance ${request.taskInstanceId} pid ${request.pid}`);
        const response = await this.taskAgentHandler.reportPid(request);
        res.status(200);
        res.json(response);
      } catch (err: any) {
        next(err);
      }
    });

    app.post('/task-reporter/termination', async (req, res, next) => {
      try {
        const request = this.assertions.assert('ReportTerminationRequest', req.body);
        logger.info(`Received request to report task instance ${request.taskInstanceId} termination.`);
        const response = await this.taskAgentHandler.reportTermination(request);
        res.status(200);
        res.json(response);
      } catch (err: any) {
        next(err);
      }
    });

    app.post('/task-reporter/exit', async (req, res, next) => {
      try {
        const request = this.assertions.assert('ReportExitRequest', req.body);
        logger.info(`Received request to report task instance ${request.taskInstanceId} exit ${request.code}.`);
        const response = await this.taskAgentHandler.reportExit(request);
        res.status(200);
        res.json(response);
      } catch (err: any) {
        next(err);
      }
    });

    app.post('/task-reporter/event', async (req, res, next) => {
      try {
        const request = this.assertions.assert('ReportEventRequest', req.body);
        logger.info(`Received request to report task instance ${request.taskInstanceId} event.`);
        const response = await this.taskAgentHandler.reportEvent(request);
        res.status(200);
        res.json(response);
      } catch (err: any) {
        next(err);
      }
    });

    app.post('/task-reporter/passive-health-check', async (req, res, next) => {
      try {
        const request = this.assertions.assert('ReportPassiveHealthCheckRequest', req.body);
        logger.info(`Received request to report task instance ${request.taskInstanceId} passive health check.`);
        const response = await this.taskAgentHandler.reportPassiveHealthCheck(request);
        res.status(200);
        res.json(response);
      } catch (err: any) {
        next(err);
      }
    });
  }
}

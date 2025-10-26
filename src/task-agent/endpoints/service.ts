import express from 'express';
import * as http from 'http';
import { ErrorHandlingMiddlewareProvider, LoggingMiddleware } from '@qinnan/express-middlewares';
import { LoggerFactory } from '@qinnan/logging-js';
import { getMetricsLogger } from '@qinnan/metrics-logger';
import { Metrics } from '@qinnan/metrics-types';
import { TaskAgentFacade } from '@qinnan/task-types';
import { assertInstanceEvent, assertTaskInstanceExit, assertTaskInstanceId, assertTaskInstancePid } from './assertions';

export interface TaskAgentServerProps {
  readonly port: number;
  readonly agentId: string;
}

const logger = LoggerFactory.getLogger('TaskAgentServer');
export class TaskAgentServer {
  private readonly props: TaskAgentServerProps;
  private readonly app: express.Express;
  private server?: http.Server;
  private readonly metrics: Metrics;
  private readonly taskAgentFacade: TaskAgentFacade;
  private readonly errorHandlingMiddlewareProvider: ErrorHandlingMiddlewareProvider;

  constructor(props: TaskAgentServerProps, taskAgentFacade: TaskAgentFacade) {
    this.app = express();
    this.props = props;
    this.taskAgentFacade = taskAgentFacade;
    this.metrics = getMetricsLogger().create({
      Service: 'taskAgentFacade',
      AgentId: this.props.agentId,
    });
    this.errorHandlingMiddlewareProvider = new ErrorHandlingMiddlewareProvider();
  }

  async start() {
    await this.__init();
    // don't use localhost. Nodejs v17 and above stop sorting ip, which causes localhost bind to the ipv6 version.
    // if client is using 127.0.0.1, which won't work with ipv6's localhost.
    this.server = this.app.listen(this.props.port, '127.0.0.1');
    logger.info(`welcome, task agent ${this.props.agentId} server is listening at port ${this.props.port}`);
  }

  async terminate() {
    logger.info('terminate task agent server');
    this.server?.close();
    logger.info('task agent server terminated');
  }

  async __init() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(LoggingMiddleware(getMetricsLogger().create()));

    this.__taskReporterEndpoints();

    this.app.use(this.errorHandlingMiddlewareProvider.build());
  }

  private __taskReporterEndpoints() {
    this.app.post('/pid', async (req, res, next) => {
      const request = req.body;
      logger.info('received request to report task instance pid');
      try {
        assertTaskInstancePid(request);
        logger.info(`reporte task instance ${request.taskInstanceId} pid ${request.pid}`);
        await this.taskAgentFacade.reportPid(request.taskInstanceId, request.pid);
        res.status(200);
        res.json({ message: 'success' });
        return;
      } catch (err) {
        next(err);
      }
    });

    this.app.post('/termination', async (req, res, next) => {
      const request = req.body;
      logger.info('received request to report task instance termination');
      try {
        assertTaskInstanceId(request);
        logger.info(`reporte task instance ${request.taskInstanceId} termination`);
        await this.taskAgentFacade.reportTermination(request.taskInstanceId);
        res.status(200);
        res.json({ message: 'success' });
        return;
      } catch (err) {
        next(err);
      }
    });

    this.app.post('/exit', async (req, res, next) => {
      const request = req.body;
      logger.info('received request to report task instance exit');
      try {
        assertTaskInstanceExit(request);
        logger.info(`reporte task instance ${request.taskInstanceId} exit code ${request.code}`);
        await this.taskAgentFacade.reportExit(request.taskInstanceId, request.code);
        res.status(200);
        res.json({ message: 'success' });
        return;
      } catch (err) {
        next(err);
      }
    });

    this.app.post('/event', async (req, res, next) => {
      const request = req.body;
      logger.info('received request to report task instance event');
      try {
        assertInstanceEvent(request);
        logger.info(`reporte task instance ${request.instanceId} ${request.level} event`);
        await this.taskAgentFacade.reportEvent(request);
        res.status(200);
        res.json({ message: 'success' });
        return;
      } catch (err) {
        next(err);
      }
    });

    this.app.post('/passive-health-check', async (req, res, next) => {
      const request = req.body;
      logger.info('received request to handle passive health check');
      try {
        assertTaskInstanceId(request);
        logger.info(`handle task instance ${request.taskInstanceId} passive health check`);
        await this.taskAgentFacade.handleHealthCheck(request.taskInstanceId);
        res.status(200);
        res.json({ message: 'success' });
        return;
      } catch (err) {
        next(err);
      }
    });
  }
}

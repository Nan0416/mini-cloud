import express from 'express';
import { LoggerFactory } from '@sparrow/logging-js';
import { ErrorHandlingMiddlewareProvider, MetricsFlusher } from '@sparrow/common-express-middlewares';
import { Endpoints } from './endpoints';
import { InternalServiceError } from '../../models';

const logger = LoggerFactory.getLogger('AgentService');

export interface AgentServiceProps {
  readonly taskAgentEndpoints: Endpoints;
  // readonly identityEndpoints: Endpoints;
}

export class AgentService {
  private readonly app: express.Express;
  private readonly taskAgentEndpoints: Endpoints;
  // private readonly identityEndpoints: Endpoints;
  private readonly errorHandlingMiddlewareProvider: ErrorHandlingMiddlewareProvider;

  constructor(props: AgentServiceProps) {
    this.app = express();
    this.taskAgentEndpoints = props.taskAgentEndpoints;
    // this.identityEndpoints = props.identityEndpoints;
    this.errorHandlingMiddlewareProvider = new ErrorHandlingMiddlewareProvider({
      serviceErrorClass: InternalServiceError,
      serviceErrorName: 'InternalServiceError',
    });
  }

  init(): express.Express {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(new MetricsFlusher().build());
    // todo: add authentication.
    this.taskAgentEndpoints.bind(this.app);
    // this.identityEndpoints.bind(this.app);
    this.app.use(this.errorHandlingMiddlewareProvider.build());
    logger.info('Agent service is up and handling request.');
    return this.app;
  }
}

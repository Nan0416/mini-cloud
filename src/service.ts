import express from 'express';
import { LoggerFactory } from '@ultrasa/dev-kit';
import { ErrorHandlingMiddlewareProvider, MetricsFlusher } from '@sparrow/common-express-middlewares';
import { Endpoints } from './endpoints';
import { InternalServiceError } from '@ultrasa/mini-cloud-models';

const logger = LoggerFactory.getLogger('Service');

export interface ServiceProps {
  readonly issueEndpoints: Endpoints;
  readonly taskEndpoints: Endpoints;
  readonly messageEndpoints: Endpoints;
}

export class Service {
  private readonly app: express.Express;
  private readonly issueEndpoints: Endpoints;
  private readonly taskEndpoints: Endpoints;
  private readonly messageEndpoints: Endpoints;
  private readonly errorHandlingMiddlewareProvider: ErrorHandlingMiddlewareProvider;

  constructor(props: ServiceProps) {
    this.app = express();
    this.taskEndpoints = props.taskEndpoints;
    this.messageEndpoints = props.messageEndpoints;
    this.issueEndpoints = props.issueEndpoints;
    this.errorHandlingMiddlewareProvider = new ErrorHandlingMiddlewareProvider({
      serviceErrorClass: InternalServiceError,
      serviceErrorName: 'InternalServiceError',
    });
  }

  init(): express.Express {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(new MetricsFlusher().build());
    // todo: authentication
    this.taskEndpoints.bind(this.app);
    this.messageEndpoints.bind(this.app);
    this.issueEndpoints.bind(this.app);
    this.app.use(this.errorHandlingMiddlewareProvider.build());
    logger.info('Service is up and is ready to handle requests.');
    return this.app;
  }
}

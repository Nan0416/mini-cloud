import express from 'express';
import { LoggerFactory } from '@sparrow/logging-js';
import { ErrorHandlingMiddlewareProvider, MetricsFlusher } from '@sparrow/common-express-middlewares';
import { Endpoints } from './endpoints';
import { InternalServiceError } from './models/models';

const logger = LoggerFactory.getLogger('Service');

export interface ServiceProps {
  readonly taskEndpoints: Endpoints;
}

export class Service {
  private readonly app: express.Express;
  private readonly taskEndpoints: Endpoints;
  private readonly errorHandlingMiddlewareProvider: ErrorHandlingMiddlewareProvider;

  constructor(props: ServiceProps) {
    this.app = express();
    this.taskEndpoints = props.taskEndpoints;
    this.errorHandlingMiddlewareProvider = new ErrorHandlingMiddlewareProvider({
      serviceErrorClass: InternalServiceError,
      serviceErrorName: 'InternalServiceError',
    });
  }

  init(): express.Express {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(new MetricsFlusher().build());
    // authentication is done by aws auth in api gateway.
    this.taskEndpoints.bind(this.app);
    this.app.use(this.errorHandlingMiddlewareProvider.build());
    logger.info('Service is up and is ready to handle requests.');
    return this.app;
  }
}

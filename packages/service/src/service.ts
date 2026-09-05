import { LoggerFactory } from '@mini-cloud/shared';
import express, { ErrorRequestHandler, RequestHandler } from 'express';
import { Endpoints } from './routes/endpoints';

const logger = LoggerFactory.getLogger('Service');

export interface ServiceProps {
  /** Which listener this application backs, for the startup line: `internal` or `public`. */
  readonly name: string;
  readonly middleware: ReadonlyArray<RequestHandler>;
  readonly endpoints: ReadonlyArray<Endpoints>;
  /** Answers a path this listener does not serve, naming the one that does. */
  readonly notFound: RequestHandler;
  readonly errorHandler: ErrorRequestHandler;
}

/** Assembles one express app. Knows nothing about what the routes actually do. */
export class Service {
  private readonly app: express.Express;
  private readonly props: ServiceProps;

  constructor(props: ServiceProps) {
    this.app = express();
    this.props = props;
  }

  init(): express.Express {
    // Task definitions are small; a cap keeps a malformed client from buffering
    // arbitrary memory.
    this.app.use(express.json({ limit: '256kb' }));
    this.app.use(express.urlencoded({ extended: true }));

    for (const middleware of this.props.middleware) {
      this.app.use(middleware);
    }
    for (const endpoints of this.props.endpoints) {
      endpoints.bind(this.app);
    }
    // After the routes, before the error handler: anything that matched no route is a
    // 404 this listener explains, rather than express's default HTML page.
    this.app.use(this.props.notFound);
    // Registered last: Express only routes to an error handler declared after the
    // routes that can fail.
    this.app.use(this.props.errorHandler);

    logger.info(`Express application for the ${this.props.name} listener initialised.`);
    return this.app;
  }
}

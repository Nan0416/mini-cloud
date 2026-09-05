import { LoggerFactory, NotFoundError } from '@mini-cloud/shared';
import { NextFunction, Request, RequestHandler, Response } from 'express';

const logger = LoggerFactory.getLogger('NotFound');

export interface NotFoundOptions {
  /** Which listener this handler belongs to, e.g. `internal`. */
  readonly plane: string;
  /** The other listener's name, port and route prefixes, for the hint. */
  readonly otherPlane: string;
  readonly otherPlanePort: number;
  readonly otherPlaneServes: ReadonlyArray<string>;
}

/**
 * The 404 for a path this listener does not serve.
 *
 * It exists because splitting one port into two created a new way to be wrong that
 * looks like a broken service: point the CLI at the internal listener and every task
 * command 404s, with nothing to suggest the port is the problem. Naming the other
 * listener and what it serves turns a ten-minute confusion into a one-line fix.
 *
 * Registered after the routes and before the error handler, so a request that matched
 * nothing lands here instead of in express's default HTML page — which no client of
 * this API can parse.
 */
export function notFoundHandler(options: NotFoundOptions): RequestHandler {
  const serves = options.otherPlaneServes.join(', ');

  return (req: Request, _res: Response, next: NextFunction): void => {
    logger.debug(`No route for ${req.method} ${req.path} on the ${options.plane} listener.`);
    next(
      new NotFoundError(
        `${req.method} ${req.path} is not served by the ${options.plane} listener. ` + `The ${options.otherPlane} listener (port ${options.otherPlanePort}) serves ${serves}.`,
      ),
    );
  };
}

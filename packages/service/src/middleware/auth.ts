import { LoggerFactory, UnauthenticatedError } from '@mini-cloud/shared';
import { NextFunction, Request, RequestHandler, Response } from 'express';

const logger = LoggerFactory.getLogger('Auth');

/** Reachable without a token, so a load balancer or `curl` can probe the service. */
const PUBLIC_PATHS = new Set(['/ping', '/health']);

/**
 * Shared-token authentication.
 *
 * A single token for the whole fleet is deliberate for a home-lab deployment: it is
 * enough to stop anything on the LAN from driving the service, without standing up
 * an identity provider. When no token is configured the middleware is not installed
 * at all, so local development needs no setup.
 */
export function bearerTokenAuth(token: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (PUBLIC_PATHS.has(req.path)) {
      next();
      return;
    }

    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      logger.warn(`Rejected ${req.method} ${req.path}: missing bearer token.`);
      next(new UnauthenticatedError('A bearer token is required.'));
      return;
    }

    if (header.slice('Bearer '.length) !== token) {
      logger.warn(`Rejected ${req.method} ${req.path}: invalid bearer token.`);
      next(new UnauthenticatedError('The supplied token is not valid.'));
      return;
    }

    next();
  };
}

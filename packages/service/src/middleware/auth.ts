import { LoggerFactory, UnauthenticatedError } from '@mini-cloud/shared';
import { NextFunction, Request, RequestHandler, Response } from 'express';

const logger = LoggerFactory.getLogger('Auth');

/** Reachable without a token, so a load balancer or `curl` can probe the service. */
const PUBLIC_PATHS = new Set(['/ping', '/health']);

/**
 * One token, shared by the console and the CLI, guarding every operation a person can
 * perform. Not fleet-wide: agents present no credential and are admitted by address on
 * the internal listener.
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

import { LoggerFactory, UnauthenticatedError } from '@mini-cloud/shared';
import { NextFunction, Request, RequestHandler, Response } from 'express';

const logger = LoggerFactory.getLogger('Auth');

/** Reachable without a token, so a load balancer or `curl` can probe the service. */
const PUBLIC_PATHS = new Set(['/ping', '/health']);

/**
 * Shared-token authentication for the public listener.
 *
 * One token shared by the console and the CLI is deliberate for a home lab: it is
 * enough to stop anything that reaches the port from driving the service, without
 * standing up an identity provider. It is not fleet-wide — agents present no
 * credential at all and are admitted by source address on the internal listener — so
 * what this guards is every operation a *person* can perform.
 *
 * There is no unauthenticated mode to fall back to: `loadConfig` always yields a token,
 * falling back to a published default when the operator set none, so this middleware is
 * always installed. That default authenticates nobody in practice — it is a placeholder
 * anyone can read — so what it buys is a service that behaves the same configured or
 * not, with the difference announced at startup rather than discovered here.
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

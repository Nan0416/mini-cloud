import { AppError, ErrorResponse, InvalidRequestError, LoggerFactory, PayloadTooLargeError } from '@mini-cloud/shared';
import { NextFunction, Request, Response } from 'express';

const logger = LoggerFactory.getLogger('ErrorHandler');

/**
 * The `AppError` for a request body that express's JSON parser could not take, or
 * undefined for anything else.
 *
 * The parser fails before any route runs, with an error carrying a `type` and a 4xx
 * `status`. Left to the generic branch, a body over the size limit answered 500, which
 * a caller reads as "try again" — and an agent did, every minute, with the same batch.
 */
function bodyParserFailure(err: Error): AppError | undefined {
  // `Reflect.get` rather than a spread: `status` sits on the error class's prototype, not on the error.
  const [type, status, length, limit]: ReadonlyArray<unknown> = ['type', 'status', 'length', 'limit'].map((key) => Reflect.get(err, key));
  if (typeof type !== 'string' || typeof status !== 'number' || status < 400 || status >= 500) {
    return undefined;
  }
  if (type === 'entity.too.large') {
    const size = typeof length === 'number' ? `${length} bytes` : 'too large';
    const cap = typeof limit === 'number' ? ` the ${limit}-byte limit` : ' the limit';
    return new PayloadTooLargeError(`The request body is ${size}, over${cap}. Send it in smaller pieces.`);
  }
  return new InvalidRequestError(`The request body could not be read: ${err.message}`);
}

/**
 * Maps `AppError` subclasses, and the JSON parser's own failures, onto HTTP responses.
 * Anything else is a bug rather than an expected failure, so it is logged in full and
 * reported as a bare 500 — internal messages are not echoed to callers.
 *
 * Must be registered after every route: Express identifies error handlers by the
 * four-argument signature, so `_next` has to stay even though it is unused.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  const expected = err instanceof AppError ? err : bodyParserFailure(err);
  if (expected !== undefined) {
    logger.warn(`${expected.name}: ${expected.message}`);
    const response: ErrorResponse = { error: expected.message, errorCode: expected.errorCode };
    res.status(expected.statusCode).json(response);
    return;
  }

  logger.error('Unhandled error while serving a request.', err);
  const response: ErrorResponse = { error: 'Internal server error', errorCode: 'INTERNAL' };
  res.status(500).json(response);
}

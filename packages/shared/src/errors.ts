export type ErrorCode = 'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'AGENT_OFFLINE' | 'INTERNAL';

/**
 * Base class for every expected failure. The service's error handler maps these to
 * HTTP responses; a bare `Error` is reserved for genuinely unexpected failures and
 * always surfaces as a 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly errorCode: ErrorCode;

  constructor(message: string, statusCode: number, errorCode: ErrorCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/** 400 — malformed request, missing fields, invalid values. */
export class InvalidRequestError extends AppError {
  constructor(message: string) {
    super(message, 400, 'INVALID_REQUEST');
  }
}

/** 401 — missing or invalid credentials. */
export class UnauthenticatedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHENTICATED');
  }
}

/** 403 — authenticated but not allowed. */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

/** 404 — resource does not exist. */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, 'NOT_FOUND');
  }
}

/** 409 — the request conflicts with current state (duplicate id, illegal transition). */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

/** 409 — the target agent is not currently connected. */
export class AgentOfflineError extends AppError {
  constructor(message: string) {
    super(message, 409, 'AGENT_OFFLINE');
  }
}

/** 500 — an invariant the service is responsible for upholding was violated. */
export class InternalServiceError extends AppError {
  constructor(message: string) {
    super(message, 500, 'INTERNAL');
  }
}

/**
 * The service could not be reached at all — connection refused, DNS failure, a
 * blocked cross-origin request, or a timeout.
 *
 * Produced by clients, never by the service, and so never seen on the wire. It is
 * still an `AppError` because callers branch on it the same way they branch on the
 * rest: "the service said no" and "there was no service to ask" need different words,
 * and folding both into `InternalServiceError` meant the web console's offline banner
 * could not tell a dead control plane from a bug in a live one.
 */
export class ServiceUnreachableError extends AppError {
  constructor(message: string) {
    super(message, 503, 'INTERNAL');
  }
}

/**
 * What answered on a port that could not be bound. `other` only on positive evidence —
 * an HTTP answer that is not mini-cloud's — so a caller can trust it enough to stop
 * pointing at its own processes.
 */
export type PortOccupant = 'mini-cloud' | 'other' | 'unknown';

/**
 * A port this process needs to listen on is already taken — most often by another copy
 * of the same process. Raised at startup and never seen on the wire; an `AppError` so
 * the CLI prints the sentence rather than a stack trace.
 */
export class PortInUseError extends ConflictError {
  readonly occupant: PortOccupant;

  constructor(message: string, occupant: PortOccupant) {
    super(message);
    this.occupant = occupant;
  }
}

/**
 * Whether `listen()` failed because something else holds the address. Checked by shape:
 * an error raised inside Node is not an `instanceof Error` from every realm.
 */
export function isAddressInUse(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'EADDRINUSE';
}

export interface ErrorResponse {
  readonly error: string;
  readonly errorCode: ErrorCode;
}

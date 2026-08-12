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

export interface ErrorResponse {
  readonly error: string;
  readonly errorCode: ErrorCode;
}

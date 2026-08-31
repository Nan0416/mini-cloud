import {
  AgentOfflineError,
  AppError,
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  InvalidRequestError,
  NotFoundError,
  ServiceUnreachableError,
  UnauthenticatedError,
} from '../src/errors';

/**
 * The whole point of this hierarchy is that a `catch` block can ask two questions —
 * "is this a failure we expected?" and "which one?" — without string matching. Both
 * answers depend on details that are easy to get wrong silently: `instanceof` across
 * a subclass chain, and the status/code pair each subclass fixes.
 */
describe('AppError', () => {
  const cases: ReadonlyArray<[AppError, number, string, string]> = [
    [new InvalidRequestError('bad body'), 400, 'INVALID_REQUEST', 'InvalidRequestError'],
    [new UnauthenticatedError(), 401, 'UNAUTHENTICATED', 'UnauthenticatedError'],
    [new ForbiddenError(), 403, 'FORBIDDEN', 'ForbiddenError'],
    [new NotFoundError('no such task'), 404, 'NOT_FOUND', 'NotFoundError'],
    [new ConflictError('already running'), 409, 'CONFLICT', 'ConflictError'],
    [new AgentOfflineError('agent is offline'), 409, 'AGENT_OFFLINE', 'AgentOfflineError'],
    [new InternalServiceError('invariant broken'), 500, 'INTERNAL', 'InternalServiceError'],
    [new ServiceUnreachableError('connection refused'), 503, 'INTERNAL', 'ServiceUnreachableError'],
  ];

  it.each(cases)('%s carries its status code and error code', (error, statusCode, errorCode) => {
    expect(error.statusCode).toBe(statusCode);
    expect(error.errorCode).toBe(errorCode);
  });

  it.each(cases)('%s names itself, so a log line says which failure it was', (error, _statusCode, _errorCode, name) => {
    // `this.constructor.name` rather than a literal per subclass: a hand-written name
    // is one more thing to forget when adding an error type.
    expect(error.name).toBe(name);
  });

  it.each(cases)('%s is catchable as an AppError and as an Error', (error) => {
    // The service's error handler branches on `instanceof AppError` to decide between
    // a mapped response and a blanket 500, so this is the load-bearing relationship.
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });

  it('keeps the subclasses distinguishable from one another', () => {
    // Extending a class whose constructor calls `super` with a fixed status is easy
    // to get subtly wrong; this pins down that the two 409s stay separate types.
    expect(new ConflictError('x')).not.toBeInstanceOf(AgentOfflineError);
    expect(new AgentOfflineError('x')).not.toBeInstanceOf(ConflictError);
    expect(new ServiceUnreachableError('x')).not.toBeInstanceOf(InternalServiceError);
  });

  it('carries the message through to Error', () => {
    expect(new NotFoundError('task 42 does not exist').message).toBe('task 42 does not exist');
    expect(String(new NotFoundError('task 42 does not exist'))).toBe('NotFoundError: task 42 does not exist');
  });

  it('gives the credential errors a default message, since there is nothing safe to add', () => {
    expect(new UnauthenticatedError().message).toBe('Unauthorized');
    expect(new ForbiddenError().message).toBe('Forbidden');
    expect(new UnauthenticatedError('token expired').message).toBe('token expired');
  });

  it('distinguishes "there was no service to ask" from "the service failed"', () => {
    // Both are the caller's problem to report, but the console shows an offline
    // banner for one and an error for the other, so they cannot share a type.
    expect(new ServiceUnreachableError('connection refused').statusCode).toBe(503);
    expect(new InternalServiceError('boom').statusCode).toBe(500);
  });

  it('has a stack that starts where it was thrown', () => {
    const error = new NotFoundError('no such task');

    expect(error.stack).toContain('NotFoundError: no such task');
    expect(error.stack).toContain('errors.test.ts');
  });
});

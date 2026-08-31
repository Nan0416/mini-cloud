import { AgentOfflineError, ConflictError, InternalServiceError, InvalidRequestError, LoggerFactory, NotFoundError, UnauthenticatedError } from '@mini-cloud/shared';
import { errorHandler } from '../../src/middleware/error-handler';
import { fakeRequest, fakeResponse, recordingNext } from './test-helpers';

const handle = (err: Error) => {
  const res = fakeResponse();
  errorHandler(err, fakeRequest(), res.asResponse(), recordingNext());
  return res;
};

describe('errorHandler', () => {
  // Every case here drives a log line by design; spying keeps the suite's output
  // about failures rather than about expected errors, and lets the two logging
  // behaviours below be asserted rather than merely observed in the scrollback.
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    const logger = LoggerFactory.getLogger('ErrorHandler');
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps each expected failure onto its status and code', () => {
    const cases: ReadonlyArray<[Error, number, string]> = [
      [new InvalidRequestError('name must not be empty'), 400, 'INVALID_REQUEST'],
      [new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
      [new NotFoundError('Task 42 does not exist.'), 404, 'NOT_FOUND'],
      [new ConflictError('Instance is already terminating.'), 409, 'CONFLICT'],
      [new AgentOfflineError('Agent mac-mini is offline.'), 409, 'AGENT_OFFLINE'],
      [new InternalServiceError('Row 7 has unrecognised status.'), 500, 'INTERNAL'],
    ];

    for (const [error, statusCode, errorCode] of cases) {
      const res = handle(error);
      expect(res.statusCode).toBe(statusCode);
      expect(res.body).toEqual({ error: error.message, errorCode });
    }
  });

  it("passes an expected failure's message through, because it was written for the caller", () => {
    const res = handle(new InvalidRequestError('duration must be at least 5000ms'));

    expect(res.body).toEqual({ error: 'duration must be at least 5000ms', errorCode: 'INVALID_REQUEST' });
  });

  it('answers a bare Error with a 500 that says nothing', () => {
    const res = handle(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

    // An unexpected failure's message is written for whoever reads the logs and can
    // name internal hosts, ports and paths. It is logged in full and not echoed.
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error', errorCode: 'INTERNAL' });
    expect(JSON.stringify(res.body)).not.toContain('5432');
  });

  it('treats a subclass of a bare Error as unexpected too', () => {
    class DatabaseError extends Error {}

    const res = handle(new DatabaseError('relation "task" does not exist'));

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error', errorCode: 'INTERNAL' });
  });

  it('always writes a body, so a caller never has to parse an empty 500', () => {
    for (const error of [new NotFoundError('gone'), new Error('boom')]) {
      expect(handle(error).body).toHaveProperty('errorCode');
    }
  });

  it('logs an expected failure at warn, without a stack', () => {
    handle(new NotFoundError('Task 42 does not exist.'));

    // These are the caller getting it wrong, not the service breaking; a stack trace
    // per 404 is noise, and at error level they would page someone.
    expect(warn).toHaveBeenCalledWith('NotFoundError: Task 42 does not exist.');
    expect(error).not.toHaveBeenCalled();
  });

  it('logs an unexpected failure at error, with the error itself for its stack', () => {
    const unexpected = new Error('connect ECONNREFUSED 127.0.0.1:5432');

    handle(unexpected);

    // The caller is told nothing, so the log is the only record of what happened —
    // it has to carry the original error, not just its message.
    expect(error).toHaveBeenCalledWith('Unhandled error while serving a request.', unexpected);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not call next, since the response is finished', () => {
    const res = fakeResponse();
    const next = recordingNext();

    errorHandler(new NotFoundError('gone'), fakeRequest(), res.asResponse(), next);

    // Passing the error on after responding would have express try to write again.
    expect(next.called).toBe(false);
    expect(res.ended).toBe(true);
  });
});

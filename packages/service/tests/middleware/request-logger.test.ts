import { LoggerFactory } from '@mini-cloud/shared';
import { requestLogger } from '../../src/middleware/request-logger';
import { fakeRequest, fakeResponse, recordingNext } from './test-helpers';

/**
 * Two things make this worth testing despite being "just logging": it logs on
 * `finish` rather than on entry, so a handler that never responds writes no line at
 * all; and the level it chooses is what keeps the polling endpoints from burying
 * everything else at one line per second per agent.
 */
describe('requestLogger', () => {
  const original = LoggerFactory.level;
  let debug: jest.SpyInstance;
  let info: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    LoggerFactory.setLevel('debug');
    const logger = LoggerFactory.getLogger('Request');
    debug = jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
    info = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    LoggerFactory.setLevel(original);
  });

  const serve = (init: Parameters<typeof fakeRequest>[0], statusCode: number) => {
    const res = fakeResponse();
    const next = recordingNext();
    requestLogger()(fakeRequest(init), res.asResponse(), next);
    res.finish(statusCode);
    return { res, next };
  };

  it('passes the request straight on, logging only once it is answered', () => {
    const res = fakeResponse();
    const next = recordingNext();

    requestLogger()(fakeRequest({ path: '/tasks' }), res.asResponse(), next);

    expect(next.called).toBe(true);
    // Nothing yet: the status code is the most useful part of the line, and it does
    // not exist until the response is written.
    expect(info).not.toHaveBeenCalled();

    res.finish(200);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('records the method, url and status', () => {
    serve({ method: 'POST', path: '/tasks', originalUrl: '/tasks?dryRun=true' }, 201);

    // originalUrl, not path: the query string is often the difference between two
    // otherwise identical lines.
    expect(info).toHaveBeenCalledWith(expect.stringContaining('POST /tasks?dryRun=true -> 201'));
  });

  it('reports how long the request took', () => {
    serve({ path: '/tasks' }, 200);

    expect(info).toHaveBeenCalledWith(expect.stringMatching(/in \d+ms$/));
  });

  it('demotes the endpoints that fire on a timer to debug', () => {
    for (const path of ['/ping', '/health', '/agent-api/heartbeat']) {
      serve({ path }, 200);
    }

    // Every agent heartbeats on an interval; at info these would be the only thing in
    // the log within a minute of starting a fleet.
    expect(debug).toHaveBeenCalledTimes(3);
    expect(info).not.toHaveBeenCalled();
  });

  it('still logs a failing heartbeat at its error level, since that is the interesting case', () => {
    serve({ path: '/agent-api/heartbeat' }, 401);
    serve({ path: '/ping' }, 500);

    // The demotion is for successful noise only — an agent whose heartbeats are being
    // rejected is exactly what someone reading the log is looking for.
    expect(debug).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('picks the level from the status class', () => {
    serve({ path: '/tasks' }, 204);
    expect(info).toHaveBeenCalledTimes(1);

    serve({ path: '/tasks' }, 404);
    expect(warn).toHaveBeenCalledTimes(1);

    serve({ path: '/tasks' }, 503);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('treats 399 as success and 400 as a client error', () => {
    serve({ path: '/tasks' }, 399);
    serve({ path: '/tasks' }, 400);

    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('treats 499 as a client error and 500 as a server error', () => {
    serve({ path: '/tasks' }, 499);
    serve({ path: '/tasks' }, 500);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for a request that is never answered', () => {
    requestLogger()(fakeRequest({ path: '/tasks' }), fakeResponse().asResponse(), recordingNext());

    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

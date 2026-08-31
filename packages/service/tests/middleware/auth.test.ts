import { UnauthenticatedError } from '@mini-cloud/shared';
import { bearerTokenAuth } from '../../src/middleware/auth';
import { fakeRequest, fakeResponse, recordingNext } from './test-helpers';

const TOKEN = 's3cret';

const run = (init: Parameters<typeof fakeRequest>[0]) => {
  const next = recordingNext();
  bearerTokenAuth(TOKEN)(fakeRequest(init), fakeResponse().asResponse(), next);
  return next;
};

describe('bearerTokenAuth', () => {
  it('lets a request carrying the right token through', () => {
    const next = run({ headers: { authorization: `Bearer ${TOKEN}` } });

    expect(next.called).toBe(true);
    expect(next.error).toBeUndefined();
  });

  it('rejects a missing Authorization header', () => {
    const next = run({});

    // Handed to `next` rather than thrown: express only routes an error to the error
    // handler when it arrives this way, and a throw from a sync handler would 500.
    expect(next.error).toBeInstanceOf(UnauthenticatedError);
    expect((next.error as Error).message).toBe('A bearer token is required.');
  });

  it('rejects the wrong token, and says so differently from a missing one', () => {
    const next = run({ headers: { authorization: 'Bearer wrong' } });

    // The distinction matters when debugging: one means the client was not configured
    // at all, the other that it was configured with the wrong value.
    expect(next.error).toBeInstanceOf(UnauthenticatedError);
    expect((next.error as Error).message).toBe('The supplied token is not valid.');
  });

  it('requires the Bearer scheme, exactly', () => {
    for (const authorization of [TOKEN, `Basic ${TOKEN}`, `bearer ${TOKEN}`, `Bearer${TOKEN}`, 'Bearer']) {
      expect(run({ headers: { authorization } }).error).toBeInstanceOf(UnauthenticatedError);
    }
  });

  it('compares the token whole, rejecting a prefix or a padded copy', () => {
    for (const supplied of ['s3cre', `${TOKEN}x`, ` ${TOKEN}`, `${TOKEN} `]) {
      expect(run({ headers: { authorization: `Bearer ${supplied}` } }).error).toBeInstanceOf(UnauthenticatedError);
    }
  });

  it('rejects a repeated header, which express hands over as an array', () => {
    expect(run({ headers: { authorization: [`Bearer ${TOKEN}`] } }).error).toBeInstanceOf(UnauthenticatedError);
  });

  it('leaves the probe endpoints open, so a health check needs no credentials', () => {
    for (const path of ['/ping', '/health']) {
      const next = run({ path });
      expect(next.called).toBe(true);
      expect(next.error).toBeUndefined();
    }
  });

  it('does not extend that exemption to paths that merely start the same way', () => {
    // `/health-checks` is a real API path and must not inherit `/health`'s exemption.
    for (const path of ['/healthz', '/health-checks', '/ping/all', '/agent-api/health']) {
      expect(run({ path }).error).toBeInstanceOf(UnauthenticatedError);
    }
  });

  it('protects every other path, including the agent API', () => {
    for (const path of ['/tasks', '/agent-api/heartbeat', '/pubsub/broadcast', '/']) {
      expect(run({ path }).error).toBeInstanceOf(UnauthenticatedError);
    }
  });
});

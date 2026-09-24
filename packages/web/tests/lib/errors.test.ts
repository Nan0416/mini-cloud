import { ForbiddenError, InternalServiceError, InvalidRequestError, NotFoundError, ServiceUnreachableError, UnauthenticatedError } from '@mini-cloud/shared';
import { isRetryable } from '@/lib/errors';

/**
 * One question answered in three places: whether a failed series offers to try again,
 * whether it keeps polling, and whether the page's error card shows its button.
 */
describe('isRetryable', () => {
  it('is worth asking again when there was no service to ask, or it failed inside', () => {
    expect(isRetryable(new ServiceUnreachableError('could not reach it'))).toBe(true);
    expect(isRetryable(new InternalServiceError('it fell over'))).toBe(true);
  });

  it('is not worth asking again when the service answered with a refusal', () => {
    // A percentile past raw retention, a token the service rejects, a metric that is
    // not there: each is refused the same way however often it is sent.
    expect(isRetryable(new InvalidRequestError('p99 is only available for the last 28 days'))).toBe(false);
    expect(isRetryable(new UnauthenticatedError())).toBe(false);
    expect(isRetryable(new ForbiddenError())).toBe(false);
    expect(isRetryable(new NotFoundError('no such metric'))).toBe(false);
  });

  it('is not worth asking again for something that is not an error we know', () => {
    expect(isRetryable(new Error('boom'))).toBe(false);
    expect(isRetryable('boom')).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });
});

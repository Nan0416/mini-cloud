import { InternalServiceError, ServiceUnreachableError } from '@mini-cloud/shared';

/**
 * Whether asking again could plausibly succeed: there was no service to ask, or it
 * failed inside. A refusal — a bad request, a missing thing, a rejected token — will be
 * refused the same way however often it is sent.
 */
export function isRetryable(error: unknown): boolean {
  return error instanceof ServiceUnreachableError || error instanceof InternalServiceError;
}

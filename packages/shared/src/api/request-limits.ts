/**
 * The largest JSON body either listener accepts.
 *
 * Shared because the agent has to stay under it: a metric batch over the limit is
 * refused before the service reads any of it, however many times it is sent.
 */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;

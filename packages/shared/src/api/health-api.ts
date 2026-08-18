/**
 * Liveness. Deliberately touches nothing but the process itself, so a `200` means
 * "this server is serving" and nothing more.
 */
export interface PingRequest {}

export interface PingResponse {
  readonly status: 'ok';
}

/** Readiness: the process is up *and* the database answers. */
export interface GetHealthRequest {}

export interface GetHealthResponse {
  readonly status: 'ok' | 'degraded';
  readonly database: 'ok' | 'unreachable';
}

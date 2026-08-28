import { MiniCloudClient } from '@mini-cloud/client';
import { config } from './config';
import { classifyProbeFailure, type Connection, type ProbeOutcome } from './connection';

/**
 * Builds the console's handle on a service.
 *
 * A factory rather than a module singleton: which service the console talks to is
 * decided by the visitor at runtime and can change without a reload, so a client
 * fixed at import time cannot express it. Components reach this through `useApi()`,
 * never by importing a client directly.
 *
 * This is the same `MiniCloudClient` the CLI and the agent use — through
 * `@mini-cloud/client`'s browser entry point, which drops the `ws`-based subscriber
 * and keeps the HTTP surface. The console only ever needs HTTP, so there is nothing
 * here to reimplement: an endpoint is written once and every caller compiles
 * against it.
 */
export function createApi(connection: Connection): MiniCloudClient {
  return new MiniCloudClient({
    baseUrl: connection.apiUrl,
    token: connection.token,
    timeoutMs: config.requestTimeoutMs,
  });
}

/**
 * Checks a candidate connection before the console commits to it.
 *
 * Two calls, because one cannot answer both questions. `/ping` is public, so it
 * proves the service is reachable without needing a token — separating "nothing
 * answered" from "something answered and refused you". Then an authenticated call,
 * whose 401 is the only way to discover that this service wants a token at all;
 * without it the screen would have to make the visitor guess whether to fill the
 * field in.
 *
 * Catching a typo here is the point. A wrong URL that gets stored instead surfaces
 * minutes later as an offline banner, which looks like a broken service rather than
 * a mistyped host.
 */
export async function probeConnection(connection: Connection): Promise<ProbeOutcome> {
  const client = createApi(connection);
  try {
    await client.ping();
  } catch (error) {
    // Never `needs-token`: /ping is public, so a failure here is transport, full stop.
    return classifyProbeFailure(error, connection.token !== undefined) === 'unreachable' ? 'unreachable' : 'error';
  }

  try {
    await client.listAgents({});
    return 'ok';
  } catch (error) {
    return classifyProbeFailure(error, connection.token !== undefined);
  }
}

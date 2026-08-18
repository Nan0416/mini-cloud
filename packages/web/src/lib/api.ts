import { MiniCloudClient } from '@mini-cloud/client';
import { config } from './config';

/**
 * The console's one handle on the service.
 *
 * This is the same `MiniCloudClient` the CLI and the agent use — imported through
 * `@mini-cloud/client`'s browser entry point, which drops the `ws`-based subscriber
 * and keeps the HTTP surface. The console only ever needs HTTP, so there is nothing
 * here to reimplement: an endpoint is written once, in one package, and every caller
 * compiles against it.
 */
export const api = new MiniCloudClient({
  baseUrl: config.apiUrl,
  token: config.token,
  // Longer than the client's 10s default. A home server can be slow to wake a
  // sleeping disk, and a spurious "unreachable" banner is worse than a slow table.
  timeoutMs: 15_000,
});

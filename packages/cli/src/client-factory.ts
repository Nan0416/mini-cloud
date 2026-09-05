import { MiniCloudClient } from '@mini-cloud/client';
import { getenv } from '@mini-cloud/shared';

/** Global options every command inherits from the root program. */
export interface GlobalOptions {
  readonly service?: string;
  readonly token?: string;
  readonly json?: boolean;
}

/**
 * The public listener, which is what serves tasks, instances, agents and variables.
 * The internal one (3000) serves agent reports and the hub, and answers a task
 * command with a 404 that says so.
 */
const DEFAULT_SERVICE_URL = 'http://127.0.0.1:3001';

/** The internal listener, where the agent API and the WebSocket hub are. */
const DEFAULT_INTERNAL_URL = 'http://127.0.0.1:3000';

/**
 * Where the CLI points and how it authenticates, resolved as
 * flag > environment > localhost default. Flags win so a single shell can talk to
 * more than one mini-cloud without re-exporting variables.
 */
export function resolveServiceUrl(options: GlobalOptions): string {
  return options.service ?? getenv('MINI_CLOUD_SERVICE_URL', DEFAULT_SERVICE_URL);
}

/**
 * The `--service` flag alone, with no default applied.
 *
 * `agent start` needs this rather than {@link resolveServiceUrl}: an agent talks to
 * the *internal* listener, and `loadAgentConfig` already defaults to it. Substituting
 * the CLI's public default here would point every agent started without a flag at the
 * one listener that does not serve them.
 */
export function serviceUrlOverride(options: GlobalOptions): string | undefined {
  return options.service;
}

/**
 * The public listener's token, which is the only one there is. `MINI_CLOUD_TOKEN` was
 * read here until the listener split, and reading it still would mean the variable the
 * service documents — `MINI_CLOUD_PUBLIC_TOKEN` — is the one variable that does not
 * authenticate the CLI.
 */
export function resolveToken(options: GlobalOptions): string | undefined {
  return options.token ?? process.env['MINI_CLOUD_PUBLIC_TOKEN'];
}

export function createClient(options: GlobalOptions): MiniCloudClient {
  return new MiniCloudClient({ baseUrl: resolveServiceUrl(options), token: resolveToken(options) });
}

/**
 * Where the WebSocket hub is, resolved as flag > environment > loopback default.
 *
 * Separate from {@link resolveServiceUrl} because the hub is attached to the internal
 * listener: `--service` names the public one, and following it would open a socket
 * against the port that has no `/ws` to answer it.
 */
export function resolveHubUrl(hub: string | undefined): string {
  return hub ?? getenv('MINI_CLOUD_INTERNAL_URL', DEFAULT_INTERNAL_URL);
}

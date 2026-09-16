import { MiniCloudClient } from '@mini-cloud/client';
import { loadConfig, ServiceConfig } from '@mini-cloud/service';

/** Global options every command inherits from the root program. */
export interface GlobalOptions {
  readonly service?: string;
  readonly token?: string;
  readonly json?: boolean;
  /** `--config`, for driving a second instance without touching the usual file. */
  readonly config?: string;
}

/**
 * The CLI's view of the configuration, read from the same files the service reads.
 *
 * One file for both, because they share a token and an address: a CLI that kept its
 * own copy would be one more place for the two to disagree, and "the console works but
 * the CLI is refused" is a confusing way to learn that.
 *
 * Read lazily, per command, rather than once at import: `mini-cloud --help` should not
 * depend on a config file being well-formed.
 */
function resolve(options: GlobalOptions): ServiceConfig {
  return loadConfig(options.config === undefined ? {} : { configPath: options.config });
}

/**
 * Where the CLI points, resolved as flag > file > default. The flag wins so a single
 * shell can talk to more than one mini-cloud without editing anything.
 */
export function resolveServiceUrl(options: GlobalOptions): string {
  return options.service ?? resolve(options).cli.serviceUrl;
}

/**
 * The `--service` flag alone, with no default applied.
 *
 * `agent start` needs this rather than {@link resolveServiceUrl}: an agent talks to the
 * *internal* listener, and `loadAgentConfig` already defaults to it. Substituting the
 * CLI's public default here would point every agent started without a flag at the one
 * listener that does not serve them.
 */
export function serviceUrlOverride(options: GlobalOptions): string | undefined {
  return options.service;
}

/** The public listener's token, which is the only one there is. */
export function resolveToken(options: GlobalOptions): string | undefined {
  return options.token ?? resolve(options).public.authToken;
}

export function createClient(options: GlobalOptions): MiniCloudClient {
  const config = resolve(options);
  return new MiniCloudClient({ baseUrl: options.service ?? config.cli.serviceUrl, token: options.token ?? config.public.authToken });
}

/**
 * Where the WebSocket hub is, resolved as flag > file > default.
 *
 * Separate from {@link resolveServiceUrl} because the hub is attached to the internal
 * listener: `--service` names the public one, and following it would open a socket
 * against the port that has no `/ws` to answer it.
 */
export function resolveHubUrl(hub: string | undefined, options: GlobalOptions = {}): string {
  return hub ?? resolve(options).cli.internalUrl;
}

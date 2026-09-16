import { MiniCloudClient } from '@mini-cloud/client';
import { loadConfig, ServiceConfig } from '@mini-cloud/service';

/** Global options every command inherits from the root program. */
export interface GlobalOptions {
  readonly json?: boolean;
  /** `--config`, for driving a second instance. */
  readonly config?: string;
}

/** The same files the service reads: they share a token and an address. */
export function resolveConfig(options: GlobalOptions): ServiceConfig {
  return loadConfig(options.config === undefined ? {} : { configPath: options.config });
}

export function createClient(options: GlobalOptions): MiniCloudClient {
  const config = resolveConfig(options);
  return new MiniCloudClient({ baseUrl: config.cli.serviceUrl, token: config.public.authToken });
}

/**
 * Where the WebSocket hub is. Separate from `cli.serviceUrl`: the hub is on the
 * internal listener, and the public one has no `/ws` to answer.
 */
export function resolveHubUrl(options: GlobalOptions = {}): string {
  return resolveConfig(options).cli.internalUrl;
}

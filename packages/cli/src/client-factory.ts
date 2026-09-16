import { MiniCloudClient } from '@mini-cloud/client';
import { loadConfig, ServiceConfig } from '@mini-cloud/service';

/** Global options every command inherits from the root program. */
export interface GlobalOptions {
  readonly service?: string;
  readonly token?: string;
  readonly json?: boolean;
  /** `--config`, for driving a second instance. */
  readonly config?: string;
}

/** The same files the service reads: they share a token and an address. */
function resolve(options: GlobalOptions): ServiceConfig {
  return loadConfig(options.config === undefined ? {} : { configPath: options.config });
}

/** Flag first, so one shell can talk to more than one mini-cloud. */
export function resolveServiceUrl(options: GlobalOptions): string {
  return options.service ?? resolve(options).cli.serviceUrl;
}

/**
 * No default applied. `agent start` needs this: an agent talks to the *internal*
 * listener, so the CLI's public default would point it at the wrong port.
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
 * Separate from {@link resolveServiceUrl}: the hub is on the internal listener, and
 * `--service` names the public one, which has no `/ws` to answer.
 */
export function resolveHubUrl(hub: string | undefined, options: GlobalOptions = {}): string {
  return hub ?? resolve(options).cli.internalUrl;
}

import { MiniCloudClient } from '@mini-cloud/client';
import { getenv } from '@mini-cloud/shared';

/** Global options every command inherits from the root program. */
export interface GlobalOptions {
  readonly service?: string;
  readonly token?: string;
  readonly json?: boolean;
}

/**
 * Where the CLI points and how it authenticates, resolved as
 * flag > environment > localhost default. Flags win so a single shell can talk to
 * more than one mini-cloud without re-exporting variables.
 */
export function resolveServiceUrl(options: GlobalOptions): string {
  return options.service ?? getenv('MINI_CLOUD_SERVICE_URL', 'http://127.0.0.1:3000');
}

export function resolveToken(options: GlobalOptions): string | undefined {
  return options.token ?? process.env['MINI_CLOUD_TOKEN'];
}

export function createClient(options: GlobalOptions): MiniCloudClient {
  return new MiniCloudClient({ baseUrl: resolveServiceUrl(options), token: resolveToken(options) });
}

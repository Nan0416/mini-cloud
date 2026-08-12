import { MiniCloudClient } from '@mini-cloud/client';
import { getenv } from '@mini-cloud/shared';
import { ParsedArgs, flag } from './args';

/**
 * Where the CLI points and how it authenticates, resolved as
 * flag > environment > localhost default. Flags win so a single shell can talk to
 * more than one mini-cloud without re-exporting variables.
 */
export function resolveServiceUrl(args: ParsedArgs): string {
  return flag(args, 'service') ?? getenv('MINI_CLOUD_SERVICE_URL', 'http://127.0.0.1:3000');
}

export function resolveToken(args: ParsedArgs): string | undefined {
  return flag(args, 'token') ?? process.env['MINI_CLOUD_TOKEN'];
}

export function createClient(args: ParsedArgs): MiniCloudClient {
  return new MiniCloudClient({ baseUrl: resolveServiceUrl(args), token: resolveToken(args) });
}

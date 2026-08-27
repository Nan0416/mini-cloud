import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

/**
 * CloudFront accepts a certificate from no other region, whatever region the resources
 * in front of it live in. Pinning the whole stack here is what lets the certificate,
 * the distribution and the DNS records stay in one stack instead of two with a
 * cross-region reference between them.
 */
export const CERTIFICATE_REGION = 'us-east-1';

export interface ConsoleConfig {
  /** The AWS account to deploy into. */
  readonly account: string;
  /** An existing Route 53 hosted zone, imported rather than created. */
  readonly hostedZoneId: string;
  /** The zone's apex, e.g. `example.com`. */
  readonly zoneName: string;
  /** Where the console is served, e.g. `console.example.com`. Must sit inside the zone. */
  readonly domainName: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is not set. Copy infra/.env.example to infra/.env and fill it in.`);
  }
  return value.trim();
}

/**
 * The single place this app reads `process.env`, mirroring the rule the runtime
 * packages follow.
 *
 * Unlike those, nothing here has a default and a missing value throws. The guideline
 * exists so that *importing* a package never fails for want of configuration; this is a
 * deploy script, and an account number guessed wrong is a stack in the wrong account.
 *
 * The values live in `infra/.env`, which is gitignored, because an account id and a
 * hosted zone id identify one person's AWS estate and belong nowhere in the source.
 */
export function loadConsoleConfig(): ConsoleConfig {
  loadDotenv({ path: path.join(__dirname, '..', '.env'), quiet: true });

  const account = required('MINI_CLOUD_AWS_ACCOUNT');
  if (!/^\d{12}$/.test(account)) {
    throw new Error(`MINI_CLOUD_AWS_ACCOUNT must be a 12-digit account id, not "${account}".`);
  }

  const hostedZoneId = required('MINI_CLOUD_HOSTED_ZONE_ID');
  if (!/^Z[A-Z0-9]+$/.test(hostedZoneId)) {
    throw new Error(`MINI_CLOUD_HOSTED_ZONE_ID must be a Route 53 zone id such as Z0123456789ABCDEFGHIJ, not "${hostedZoneId}".`);
  }

  const zoneName = required('MINI_CLOUD_ZONE_NAME');
  const domainName = required('MINI_CLOUD_CONSOLE_DOMAIN');
  // Checked here rather than discovered after deploying: an alias record whose name
  // falls outside its zone is not an error CloudFormation raises, it is a record
  // created in a zone that nothing asks, so the domain simply never resolves.
  if (domainName !== zoneName && !domainName.endsWith(`.${zoneName}`)) {
    throw new Error(`MINI_CLOUD_CONSOLE_DOMAIN ("${domainName}") must sit inside MINI_CLOUD_ZONE_NAME ("${zoneName}"), or the DNS records land in a zone that does not serve it.`);
  }

  return { account, hostedZoneId, zoneName, domainName };
}

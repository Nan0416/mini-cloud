import { InvalidRequestError } from '@mini-cloud/shared';

/**
 * Value coercion for commander options.
 *
 * These are domain rules, not argument parsing — commander handles the grammar, and
 * what counts as a valid interval or timestamp belongs to mini-cloud. Passing them
 * as commander's parse callbacks means a bad value is rejected before any command
 * body runs.
 */

const DURATION_UNITS: Readonly<Record<string, number>> = { ms: 1, s: 1_000, m: 60_000, h: 3600_000, d: 86400_000 };

/** Parses `30s`, `5m`, `2h`, `1d` or a bare millisecond count. */
export function parseDuration(value: string, name: string): number {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(value.trim());
  if (match === null) {
    throw new InvalidRequestError(`--${name} must look like 30s, 5m, 2h or 1d (got "${value}")`);
  }
  return Number(match[1]) * DURATION_UNITS[match[2] ?? 'ms'];
}

/** Parses an ISO timestamp, an epoch-ms number, or the literal `now`. */
export function parseTimestamp(value: string, name: string): number {
  if (value === 'now') {
    return Date.now();
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new InvalidRequestError(`--${name} must be an ISO timestamp, epoch milliseconds, or "now" (got "${value}")`);
  }
  return parsed;
}

/** Parses repeated `KEY=VALUE` arguments into a map. */
export function parseKeyValues(values: ReadonlyArray<string>, name: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of values) {
    const equals = entry.indexOf('=');
    if (equals <= 0) {
      throw new InvalidRequestError(`${name} must look like KEY=VALUE (got "${entry}")`);
    }
    result[entry.slice(0, equals)] = entry.slice(equals + 1);
  }
  return result;
}

export function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidRequestError(`--${name} must be a positive integer (got "${value}")`);
  }
  return parsed;
}

/** Commander callback that accumulates a repeatable option into an array. */
export function collect(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

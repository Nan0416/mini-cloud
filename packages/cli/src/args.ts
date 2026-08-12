import { InvalidRequestError } from '@mini-cloud/shared';

export interface ParsedArgs {
  /** Non-flag arguments, in order. */
  readonly positionals: ReadonlyArray<string>;
  /** Flag values. A flag may repeat, so every entry is a list. */
  readonly flags: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Everything after a bare `--`, passed through untouched. */
  readonly passthrough: ReadonlyArray<string>;
}

/**
 * A small argv parser.
 *
 * Deliberately not a CLI framework: the grammar here is a dozen flags, and a
 * dependency that pulls in its own help renderer and coercion rules would be more
 * code to understand than the parser itself.
 *
 * Supports `--flag value`, `--flag=value`, repeated flags, boolean flags, and `--`
 * to stop parsing so a task's own arguments survive intact.
 */
export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const passthrough: string[] = [];

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];

    if (token === '--') {
      passthrough.push(...argv.slice(index + 1));
      break;
    }

    if (!token.startsWith('--')) {
      positionals.push(token);
      index += 1;
      continue;
    }

    const body = token.slice(2);
    const equals = body.indexOf('=');
    if (equals !== -1) {
      append(flags, body.slice(0, equals), body.slice(equals + 1));
      index += 1;
      continue;
    }

    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      // A flag with no value is a boolean; `--json` and `--json=true` mean the same.
      append(flags, body, 'true');
      index += 1;
      continue;
    }

    append(flags, body, next);
    index += 2;
  }

  return { positionals, flags, passthrough };
}

function append(flags: Map<string, string[]>, key: string, value: string): void {
  const existing = flags.get(key);
  if (existing === undefined) {
    flags.set(key, [value]);
  } else {
    existing.push(value);
  }
}

export function flag(args: ParsedArgs, name: string): string | undefined {
  const values = args.flags.get(name);
  return values === undefined ? undefined : values[values.length - 1];
}

export function flagList(args: ParsedArgs, name: string): string[] {
  return [...(args.flags.get(name) ?? [])];
}

export function requireFlag(args: ParsedArgs, name: string): string {
  const value = flag(args, name);
  if (value === undefined) {
    throw new InvalidRequestError(`--${name} is required`);
  }
  return value;
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  const value = flag(args, name);
  return value === 'true' || value === '';
}

export function requirePositional(args: ParsedArgs, index: number, name: string): string {
  const value = args.positionals[index];
  if (value === undefined) {
    throw new InvalidRequestError(`<${name}> is required`);
  }
  return value;
}

const DURATION_UNITS: Readonly<Record<string, number>> = { ms: 1, s: 1_000, m: 60_000, h: 3600_000, d: 86400_000 };

/** Parses `30s`, `5m`, `2h`, `1d` or a bare millisecond count. */
export function parseDuration(value: string, name: string): number {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(value.trim());
  if (match === null) {
    throw new InvalidRequestError(`--${name} must look like 30s, 5m, 2h or 1d (got "${value}")`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  return amount * DURATION_UNITS[unit];
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

/** Parses repeated `--env KEY=VALUE` flags into a map. */
export function parseKeyValues(values: ReadonlyArray<string>, name: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of values) {
    const equals = entry.indexOf('=');
    if (equals <= 0) {
      throw new InvalidRequestError(`--${name} must look like KEY=VALUE (got "${entry}")`);
    }
    result[entry.slice(0, equals)] = entry.slice(equals + 1);
  }
  return result;
}

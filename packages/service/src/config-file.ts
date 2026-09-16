import { LoggerFactory } from '@mini-cloud/shared';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const logger = LoggerFactory.getLogger('ConfigFile');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Structural, not `instanceof Error`: Jest runs modules in their own vm context, so an
 * error from Node core fails that check and every absent file reads as unreadable.
 */
function errorCode(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string' ? value.code : undefined;
}

function errorMessage(value: unknown): string {
  return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string' ? value.message : String(value);
}

/** Everything mini-cloud keeps for the operator. */
export function configDir(): string {
  return join(homedir(), '.mini-cloud');
}

/** Settings. Safe to paste into an issue or keep in a dotfiles repo. */
export function configPath(): string {
  return join(configDir(), 'config.json');
}

/** Credentials, kept apart so that "show me your config" stays a safe request. */
export function secretPath(): string {
  return join(configDir(), 'secret.json');
}

/**
 * `undefined` when the file is absent, which is fine — every value has a default. A
 * file that exists and will not parse throws: falling back to defaults there would look
 * exactly like the settings being ignored.
 */
export function readConfigObject(path: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') {
      return undefined;
    }
    throw new Error(`Could not read ${path}: ${errorMessage(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${errorMessage(err)}. Fix it or delete it; mini-cloud will not start on a file it cannot read.`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain a JSON object, for example {"internal": {"port": 3000}}.`);
  }
  return { ...parsed };
}

/**
 * Every getter records the key it consumed, so {@link Section.reportUnknownKeys} can
 * warn about the rest. A misspelled key is otherwise indistinguishable from a default.
 */
export class Section {
  private readonly known = new Set<string>();

  constructor(
    private readonly values: Record<string, unknown>,
    /** Dotted path for messages, e.g. `internal`, or the filename at the root. */
    private readonly where: string,
  ) {}

  private fail(key: string, expected: string, actual: unknown): never {
    throw new Error(`${this.where}.${key} must be ${expected}, but it is ${JSON.stringify(actual)}.`);
  }

  string(key: string, fallback: string): string {
    this.known.add(key);
    const value = this.values[key];
    if (value === undefined) {
      return fallback;
    }
    return typeof value === 'string' ? value : this.fail(key, 'a string', value);
  }

  integer(key: string, fallback: number): number {
    this.known.add(key);
    const value = this.values[key];
    if (value === undefined) {
      return fallback;
    }
    return typeof value === 'number' && Number.isInteger(value) ? value : this.fail(key, 'a whole number', value);
  }

  /** `[]` means empty, not unset: it is how `corsOrigins` and `trustedSubnets` are switched off. */
  stringList(key: string, fallback: ReadonlyArray<string>): ReadonlyArray<string> {
    this.known.add(key);
    const value = this.values[key];
    if (value === undefined) {
      return fallback;
    }
    return isStringArray(value) ? value : this.fail(key, 'an array of strings', value);
  }

  /**
   * A whole number above zero — ports, intervals, thresholds, retention.
   *
   * The check the deleted `--port` flags used to apply. Without it `{"port": -1}` loads
   * cleanly and fails inside `server.listen()` naming no setting, and `{"jobTickMs": 0}`
   * gives a timer that spins.
   */
  positiveInteger(key: string, fallback: number): number {
    const value = this.integer(key, fallback);
    return value > 0 ? value : this.fail(key, 'greater than zero', value);
  }

  optionalPositiveInteger(key: string): number | undefined {
    const value = this.optionalInteger(key);
    return value === undefined || value > 0 ? value : this.fail(key, 'greater than zero', value);
  }

  /** `undefined` when absent, for a section whose defaults are applied elsewhere. */
  optionalString(key: string): string | undefined {
    this.known.add(key);
    const value = this.values[key];
    if (value === undefined) {
      return undefined;
    }
    return typeof value === 'string' ? value : this.fail(key, 'a string', value);
  }

  optionalInteger(key: string): number | undefined {
    this.known.add(key);
    const value = this.values[key];
    if (value === undefined) {
      return undefined;
    }
    return typeof value === 'number' && Number.isInteger(value) ? value : this.fail(key, 'a whole number', value);
  }

  /** Absent reads as empty, so defaults apply. */
  section(key: string): Section {
    this.known.add(key);
    const value = this.values[key];
    if (value === undefined) {
      return new Section({}, `${this.where}.${key}`);
    }
    if (!isRecord(value)) {
      return this.fail(key, 'an object', value);
    }
    return new Section({ ...value }, `${this.where}.${key}`);
  }

  /** Warns rather than throws: a stray key is not a reason to refuse to start. */
  reportUnknownKeys(): void {
    const unknown = Object.keys(this.values).filter((key) => !this.known.has(key));
    if (unknown.length > 0) {
      logger.warn(
        `${this.where}: ignoring ${unknown.length === 1 ? 'a setting' : 'settings'} mini-cloud does not recognise: ${unknown.join(', ')}. Check the spelling against dev.md.`,
      );
    }
  }
}

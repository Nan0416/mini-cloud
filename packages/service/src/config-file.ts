import { LoggerFactory } from '@mini-cloud/shared';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const logger = LoggerFactory.getLogger('ConfigFile');

/**
 * Narrowing helpers rather than casts.
 *
 * `JSON.parse` hands back `any`, and asserting a shape onto it would move every type
 * error in a config file from this module to wherever the value was eventually used —
 * which is exactly the distance this file exists to remove.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * A thrown value's `code` and `message`, read structurally rather than through
 * `instanceof Error`.
 *
 * `instanceof` is not dependable for these. Jest runs each module in its own vm
 * context, and an error constructed by Node core — every `fs` error — is built from
 * that realm's `Error`, not the one the module under test sees, so the check returns
 * false for exactly the errors this file has to classify. It turned "there is no config
 * file" into "the config file could not be read", which is the difference between
 * starting on defaults and refusing to start at all.
 */
function errorCode(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string' ? value.code : undefined;
}

function errorMessage(value: unknown): string {
  return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string' ? value.message : String(value);
}

/** Everything mini-cloud keeps for the operator, on whichever machine they are on. */
export function configDir(): string {
  return join(homedir(), '.mini-cloud');
}

/** Settings. Safe to read, safe to paste into an issue, safe to keep in a dotfiles repo. */
export function configPath(): string {
  return join(configDir(), 'config.json');
}

/**
 * Credentials, kept apart from settings for one reason: people share config files.
 *
 * The permissions argument is the weaker one — a single 0600 `config.json` would
 * protect the token just as well. What the split buys is that "show me your config"
 * stays a safe request, which matters more the moment there is a second secret to
 * keep, and §1/§2 of md/PLANNED-CHANGES.md are both heading that way.
 */
export function secretPath(): string {
  return join(configDir(), 'secret.json');
}

/**
 * Reads a JSON object from disk, or `undefined` when there is no such file.
 *
 * Absent is not an error: every value has a default, so a machine with no config at
 * all runs. Present-but-broken very much is. A config file that fails to parse must
 * never be treated as absent — silently falling back to defaults is how a service
 * comes up on the wrong port, listening on the wrong address, and nobody finds out
 * until they go looking for why their settings are being ignored.
 */
export function readConfigObject(path: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    // An absent file is the ordinary case; anything else is a real problem worth
    // stopping for — an unreadable file, a directory where a file should be.
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
 * A reader over one file that reports what it could not understand.
 *
 * Every getter records the key it consumed, so {@link Section.reportUnknownKeys} can
 * warn about the rest. A misspelled `"databaseUrl"` is otherwise completely silent —
 * the value is simply the default, which looks identical to the file being ignored,
 * and is the single most common way a config file wastes an afternoon.
 */
export class Section {
  private readonly known = new Set<string>();

  constructor(
    private readonly values: Record<string, unknown>,
    /** Dotted path for messages, e.g. `internal` or the file name at the root. */
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

  /**
   * A list, where an empty one means "empty" rather than "unset".
   *
   * The distinction is the whole point for `corsOrigins` and `trustedSubnets`: `[]` is
   * the documented way to switch each check off, and collapsing it to the default
   * would turn the way to disable a check into the way to keep it on. JSON makes this
   * easy in a way the environment never did — `[]` and absent are different values.
   */
  stringList(key: string, fallback: ReadonlyArray<string>): ReadonlyArray<string> {
    this.known.add(key);
    const value = this.values[key];
    if (value === undefined) {
      return fallback;
    }
    return isStringArray(value) ? value : this.fail(key, 'an array of strings', value);
  }

  /** A nested object, as its own {@link Section}. Absent reads as empty, so defaults apply. */
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

  /**
   * Warns rather than throws.
   *
   * An unknown key is far more often a typo than a mistake worth refusing to start
   * over — and a control plane that will not come up because someone left a `"comment"`
   * in their config is worse than one that says it ignored it.
   */
  reportUnknownKeys(): void {
    const unknown = Object.keys(this.values).filter((key) => !this.known.has(key));
    if (unknown.length > 0) {
      logger.warn(
        `${this.where}: ignoring ${unknown.length === 1 ? 'a setting' : 'settings'} mini-cloud does not recognise: ${unknown.join(', ')}. Check the spelling against dev.md.`,
      );
    }
  }
}

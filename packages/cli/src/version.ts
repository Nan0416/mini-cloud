import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The CLI's version, from `package.json` beside `dist/`.
 *
 * The binary build replaces this module with a generated one holding the literal that
 * CI stamped: a single executable has no `package.json` to read, and a hard-coded
 * string here made every released binary report the same version whatever the tag said.
 */
export function cliVersion(): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof parsed.version === 'string') {
      return parsed.version;
    }
  } catch {
    // Falls through: a version is not worth failing a command over.
  }
  return '0.0.0-unknown';
}

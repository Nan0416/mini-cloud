import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SelfExec {
  readonly execPath: string;
  /** The script for the `node script.js` form; empty for the binary, which has none. */
  readonly entryArgs: ReadonlyArray<string>;
}

/**
 * Read through `getBuiltinModule` rather than `require('node:sea')`: the bundler
 * rewrites a bare require and strips the prefix, which the SEA loader then rejects.
 */
export function isSeaBinary(): boolean {
  try {
    return process.getBuiltinModule('node:sea').isSea();
  } catch {
    return false;
  }
}

/**
 * How to spell "run this CLI again" in a service unit, which outlives the shell that
 * wrote it. Symlinks are resolved so `npm link` does not bake an indirection into it.
 */
export function resolveSelfExec(argv: ReadonlyArray<string> = process.argv): SelfExec {
  if (isSeaBinary()) {
    return { execPath: process.execPath, entryArgs: [] };
  }
  const script = argv[1];
  if (script === undefined) {
    throw new Error('Cannot resolve how this CLI was invoked: process.argv has no script path.');
  }
  return { execPath: process.execPath, entryArgs: [realpathSync(resolve(script))] };
}

export function serviceArgv(subcommand: ReadonlyArray<string>, self: SelfExec = resolveSelfExec()): ReadonlyArray<string> {
  return [self.execPath, ...self.entryArgs, ...subcommand];
}

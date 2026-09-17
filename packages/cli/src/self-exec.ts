import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

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

function realpathOf(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/** `argv0` as the shell ran it: a path, or a bare name found on the PATH. */
function invokedAs(argv0: string, pathEnv: string): string | undefined {
  if (argv0.length === 0) {
    return undefined;
  }
  if (argv0.includes('/')) {
    return resolve(argv0);
  }
  return pathEnv
    .split(delimiter)
    .filter((dir) => dir.length > 0)
    .map((dir) => resolve(dir, argv0))
    .find((candidate) => realpathOf(candidate) !== undefined);
}

/**
 * A path that resolves to this binary through a symlink — the one `install.sh` puts on
 * the PATH — or the binary itself when there is none.
 *
 * `process.execPath` has already followed that symlink to one version's file. A unit
 * naming the file would stay on that version after an update, and fail to start once
 * the installer prunes it; a unit naming the symlink runs whatever was installed last.
 */
export function stableBinaryPath(execPath: string, argv0: string, pathEnv: string, home: string): string {
  const binary = realpathOf(execPath);
  if (binary === undefined) {
    return execPath;
  }
  const candidates = [invokedAs(argv0, pathEnv), join(home, '.local', 'bin', 'mini-cloud')];
  return candidates.find((candidate) => candidate !== undefined && candidate !== binary && realpathOf(candidate) === binary) ?? execPath;
}

/**
 * How to spell "run this CLI again" in a service unit, which outlives the shell that
 * wrote it. A checkout's script is resolved so `npm link` does not bake an indirection
 * into it; the binary keeps the installer's, which is the one indirection it wants.
 */
export function resolveSelfExec(argv: ReadonlyArray<string> = process.argv): SelfExec {
  if (isSeaBinary()) {
    return { execPath: stableBinaryPath(process.execPath, process.argv0, process.env['PATH'] ?? '', homedir()), entryArgs: [] };
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

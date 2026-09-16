import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * How to re-invoke this CLI as a service unit.
 *
 * The daemon is not a second program: the unit runs `mini-cloud serve`, the same
 * command a terminal runs. What differs is how to *spell* that, because the CLI ships
 * in two forms — `node bin/mini-cloud.js` from a checkout, and a single-file binary
 * with no script path at all. A unit written for one form does not work for the other,
 * and the unit outlives the shell that wrote it, so this is resolved once at install
 * time and baked in.
 */
export interface SelfExec {
  /** The executable the unit runs. */
  readonly execPath: string;
  /** What comes before the subcommand: the script for the Node form, nothing for a binary. */
  readonly entryArgs: ReadonlyArray<string>;
}

/**
 * True when running as an injected single executable.
 *
 * Read through `process.getBuiltinModule` rather than a static `require('node:sea')`:
 * the bundler rewrites a bare require and strips the `node:` prefix, which the SEA
 * loader then refuses. `getBuiltinModule` is a plain runtime call the bundler leaves
 * alone, and it is absent on Node without SEA support, which is the same answer.
 */
export function isSeaBinary(): boolean {
  try {
    return process.getBuiltinModule('node:sea').isSea();
  } catch {
    return false;
  }
}

/**
 * Resolves through symlinks, so a unit survives a reinstall.
 *
 * `npm link` puts `mini-cloud` on the PATH as a symlink into the checkout. Baking the
 * link would leave the unit pointing at whatever that name means later; baking the
 * real path pins the unit to the code it was installed from, which is what someone
 * running `daemon start` from a checkout means.
 */
export function resolveSelfExec(argv: ReadonlyArray<string> = process.argv): SelfExec {
  if (isSeaBinary()) {
    // A binary dispatches its own subcommands: `process.argv` is [execPath, ...args]
    // with no script slot to reproduce.
    return { execPath: process.execPath, entryArgs: [] };
  }
  const script = argv[1];
  if (script === undefined) {
    throw new Error('Cannot resolve how this CLI was invoked: process.argv has no script path.');
  }
  return { execPath: process.execPath, entryArgs: [realpathSync(resolve(script))] };
}

/** The full argv a service unit runs, ending in the subcommand it supervises. */
export function serviceArgv(subcommand: ReadonlyArray<string>, self: SelfExec = resolveSelfExec()): ReadonlyArray<string> {
  return [self.execPath, ...self.entryArgs, ...subcommand];
}

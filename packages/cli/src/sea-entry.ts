/**
 * Entry point for the single-file build.
 *
 * `src/index.ts` only re-exports, and `bin/mini-cloud.js` is a shell script that
 * requires the compiled output — neither is something a bundler can start from. This
 * is the binary's equivalent of that shell script: the one file whose job is to run
 * the program rather than describe it.
 */
import { run } from './cli';

run();

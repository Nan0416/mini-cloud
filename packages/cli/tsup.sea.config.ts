import { resolve } from 'node:path';
import { defineConfig, type Options } from 'tsup';

type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number];

/** Where the generator writes the compiled-in SQL. */
const GENERATED_MIGRATIONS = resolve(__dirname, 'build/generated/embedded-migrations.ts');

/**
 * The one substitution that makes the binary self-contained.
 *
 * `migrate.ts` reads its SQL from a directory resolved out of `__dirname`, which
 * inside a single executable names a path that does not exist. Swapping the empty
 * `embedded-migrations` placeholder for a module generated from
 * `packages/service/migrations` puts the schema inside the binary, and
 * `defaultMigrationSource()` then picks it up with no knowledge of SEA at all.
 *
 * A resolve plugin rather than esbuild's `alias`, which only accepts bare module
 * names — an absolute path is rejected outright.
 */
const embedMigrations: EsbuildPlugin = {
  name: 'embed-migrations',
  setup(build) {
    build.onResolve({ filter: /(^|\/)embedded-migrations$/ }, () => ({ path: GENERATED_MIGRATIONS }));
  },
};

/**
 * The single-file bundle a Node SEA is built from.
 *
 * Different from the ordinary `tsc` build in three ways the format forces:
 *   - CommonJS, because a SEA's injected main must be CJS;
 *   - everything inlined, because a binary has no `node_modules` to resolve from —
 *     `commander`, `pg`, `ws` and all four `@mini-cloud/*` packages go inside it;
 *   - no code splitting, because a SEA loads exactly one script.
 *
 * Node built-ins stay external on their own.
 */
export default defineConfig({
  entry: { 'mini-cloud-sea': 'src/sea-entry.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: false,
  dts: false,
  outDir: 'build/sea',
  noExternal: [/.*/],
  esbuildPlugins: [embedMigrations],
});

/**
 * The migrations compiled into a single-file build.
 *
 * Empty here, and replaced wholesale by the binary build: `tsup.sea.config.ts` aliases
 * this module to a file generated from `migrations/` at build time. Everything else —
 * `npm start`, the tests, a global install from a checkout — keeps reading the real
 * directory, which is what makes adding a migration a matter of dropping in a `.sql`
 * file and nothing else.
 *
 * The indirection exists because a single executable has no files beside it.
 * `defaultMigrationsDir()` resolves out of `__dirname`, which inside a binary points
 * at a path that does not exist, so a binary that shipped without this would start,
 * connect to Postgres and then die trying to read its own schema.
 *
 * Compiling them in rather than shipping a directory alongside also pins the schema to
 * the binary that was built with it. A sidecar can be stale, half-copied, or somebody
 * else's.
 */
export const EMBEDDED_MIGRATIONS: Readonly<Record<string, string>> = {};

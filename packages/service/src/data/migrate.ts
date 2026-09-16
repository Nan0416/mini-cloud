import { LoggerFactory } from '@mini-cloud/shared';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { EMBEDDED_MIGRATIONS } from './embedded-migrations';

const logger = LoggerFactory.getLogger('Migrator');

/** `migrations/` sits next to `dist/`, so resolve up out of whichever we are running from. */
export function defaultMigrationsDir(): string {
  return path.resolve(__dirname, '..', '..', 'migrations');
}

/** `001_initial.sql` — a numeric sequence, an underscore, then a descriptive name. */
const MIGRATION_FILENAME = /^(\d+)_[A-Za-z0-9_-]+\.sql$/;

interface MigrationFile {
  readonly file: string;
  readonly sequence: number;
}

/**
 * Migration files in the order they must be applied.
 *
 * Order is everything: a migration that adds a column runs against the table an
 * earlier one created, so applying them out of order either fails loudly or, worse,
 * succeeds into a schema that differs from everyone else's.
 *
 * Two things could silently get this wrong, so both are ruled out here rather than
 * left to convention:
 *
 * - `readdirSync` order is filesystem-dependent and not guaranteed by Node. It comes
 *   back sorted on APFS and effectively arbitrary on ext4, which is the difference
 *   between a developer's Mac and CI.
 * - A plain `.sort()` is lexicographic, so it only yields numeric order while every
 *   filename is zero-padded to the same width — `10_x.sql` sorts before `2_x.sql`.
 *   The sequence is parsed and compared as a number instead, so padding is cosmetic.
 */
export function listMigrationFiles(migrationsDir: string): ReadonlyArray<string> {
  return orderMigrations(readdirSync(migrationsDir, { withFileTypes: true }).flatMap((entry) => (entry.isFile() ? [entry.name] : [])));
}

/** Split out so compiled-in migrations are ordered by the same code as files on disk. */
export function orderMigrations(filenames: ReadonlyArray<string>): ReadonlyArray<string> {
  const migrations: MigrationFile[] = [];
  const bySequence = new Map<number, string>();

  for (const file of filenames) {
    // A README or a .keep is not a migration, and should not fail the naming rule.
    if (!file.endsWith('.sql')) {
      continue;
    }
    const match = MIGRATION_FILENAME.exec(file);
    if (match === null) {
      throw new Error(`Migration "${file}" is not named <sequence>_<name>.sql, for example 002_add_artifacts.sql. Rename it so its position in the order is unambiguous.`);
    }

    const sequence = Number(match[1]);
    // Two branches each adding an `002_` collide on merge, and which one ran first
    // would then depend on the filesystem. Fail rather than pick one.
    const existing = bySequence.get(sequence);
    if (existing !== undefined) {
      throw new Error(`Migrations "${existing}" and "${file}" share sequence number ${sequence}. Renumber one of them so the order is defined.`);
    }
    bySequence.set(sequence, file);
    migrations.push({ file, sequence });
  }

  return migrations.sort((left, right) => left.sequence - right.sequence).map((migration) => migration.file);
}

/** A directory on disk, or the binary itself — a single executable has no directory. */
export interface MigrationSource {
  /** Filenames, already in the order they must be applied. */
  list(): ReadonlyArray<string>;
  read(file: string): string;
  /** Where these came from, for the log line that says what ran. */
  describe(): string;
}

export function directoryMigrations(migrationsDir: string = defaultMigrationsDir()): MigrationSource {
  return {
    list: () => listMigrationFiles(migrationsDir),
    read: (file) => readFileSync(path.join(migrationsDir, file), 'utf-8'),
    describe: () => migrationsDir,
  };
}

export function embeddedMigrations(files: Readonly<Record<string, string>> = EMBEDDED_MIGRATIONS): MigrationSource {
  return {
    list: () => orderMigrations(Object.keys(files)),
    read: (file) => {
      const sql = files[file];
      if (sql === undefined) {
        throw new Error(`Migration "${file}" is not compiled into this build. The binary was built from a different set of migrations than it is trying to apply.`);
      }
      return sql;
    },
    describe: () => 'this build',
  };
}

/** "Did the build put anything here", not "am I a binary". */
export function defaultMigrationSource(): MigrationSource {
  return Object.keys(EMBEDDED_MIGRATIONS).length > 0 ? embeddedMigrations() : directoryMigrations();
}

/**
 * Applies every migration not yet applied, in order, each in its own transaction. Safe
 * to run on every service start.
 */
export async function migrate(pool: Pool, source: MigrationSource | string = defaultMigrationSource()): Promise<ReadonlyArray<string>> {
  const migrations = typeof source === 'string' ? directoryMigrations(source) : source;
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migration (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');

  const applied = await pool.query<{ id: string }>('SELECT id FROM schema_migration');
  const appliedIds = new Set(applied.rows.map((row) => row.id));

  const files = migrations.list();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (appliedIds.has(file)) {
      continue;
    }
    logger.info(`Applying migration ${file}.`);
    const sql = migrations.read(file);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migration (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      newlyApplied.push(file);
      logger.info(`Applied migration ${file}.`);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Migration ${file} failed and was rolled back.`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  if (newlyApplied.length === 0) {
    logger.info(`Schema is up to date (${files.length} migrations from ${migrations.describe()} already applied).`);
  }
  return newlyApplied;
}

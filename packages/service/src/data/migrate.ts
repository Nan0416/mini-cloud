import { LoggerFactory } from '@mini-cloud/shared';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { Pool } from 'pg';

const logger = LoggerFactory.getLogger('Migrator');

/** `migrations/` sits next to `dist/`, so resolve up out of whichever we are running from. */
export function defaultMigrationsDir(): string {
  return path.resolve(__dirname, '..', '..', 'migrations');
}

/**
 * Applies every `.sql` file in `migrationsDir` that has not been applied yet, in
 * filename order, each in its own transaction. Safe to run on every service start.
 */
export async function migrate(pool: Pool, migrationsDir: string = defaultMigrationsDir()): Promise<ReadonlyArray<string>> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migration (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');

  const applied = await pool.query<{ id: string }>('SELECT id FROM schema_migration');
  const appliedIds = new Set(applied.rows.map((row) => row.id));

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (appliedIds.has(file)) {
      continue;
    }
    logger.info(`Applying migration ${file}.`);
    const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');
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
    logger.info(`Schema is up to date (${files.length} migrations already applied).`);
  }
  return newlyApplied;
}

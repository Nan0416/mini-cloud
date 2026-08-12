import { LoggerFactory } from '@mini-cloud/shared';
import config from '../stage-config';
import { migrate } from './migrate';
import { createPool } from './pool';

const logger = LoggerFactory.getLogger('migrate-cli');

/** `npm run migrate` — applies pending migrations and exits. */
async function main(): Promise<void> {
  const pool = createPool({ connectionString: config.databaseUrl });
  try {
    const applied = await migrate(pool);
    logger.info(applied.length > 0 ? `Applied ${applied.length} migration(s): ${applied.join(', ')}.` : 'Nothing to apply.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  logger.error('Migration failed.', err);
  process.exit(1);
});

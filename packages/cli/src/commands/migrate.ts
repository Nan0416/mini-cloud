import { config, createPool, migrate } from '@mini-cloud/service';
import { ParsedArgs, flag } from '../args';

/** `mini-cloud migrate` — applies pending schema migrations and exits. */
export async function migrateCommand(args: ParsedArgs): Promise<void> {
  const pool = createPool({ connectionString: flag(args, 'database-url') ?? config.databaseUrl });
  try {
    const applied = await migrate(pool);
    console.log(applied.length > 0 ? `Applied ${applied.length} migration(s): ${applied.join(', ')}` : 'Schema is already up to date.');
  } finally {
    await pool.end();
  }
}

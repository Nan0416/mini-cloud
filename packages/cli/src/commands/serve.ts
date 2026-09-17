import { LoadConfigOptions, MiniCloudServer, createPool, loadConfig, migrate } from '@mini-cloud/service';
import { LoggerFactory } from '@mini-cloud/shared';
import { Command } from 'commander';
import { CONTROL_PLANE_UNIT } from '../service';
import { explainPortConflict } from './daemon';

const logger = LoggerFactory.getLogger('serve');

/**
 * `--config` off the root program, which is where it is declared.
 *
 * A subcommand's action receives its own command, so the root's options are one hop up
 * rather than in scope. Absent means the usual `~/.mini-cloud/config.json`.
 */
function configOption(command: Command): LoadConfigOptions {
  const path: unknown = command.parent?.opts()['config'];
  return typeof path === 'string' ? { configPath: path } : {};
}

export function buildServeCommand(): Command {
  return new Command('serve')
    .description('start the control plane: two HTTP listeners, the pub/sub hub and the scheduler')
    .option('--skip-migrations', 'do not apply pending migrations on startup')
    .action(async (options: { skipMigrations?: boolean }, command: Command) => {
      // Read here rather than at import: every other command would otherwise depend on
      // this machine's config file being well-formed just to parse an argument.
      const config = loadConfig(configOption(command));

      let server: MiniCloudServer;
      try {
        server = await MiniCloudServer.start(config, { runMigrations: options.skipMigrations !== true });
      } catch (err) {
        throw explainPortConflict(err, CONTROL_PLANE_UNIT);
      }

      // Shut down in an orderly way so in-flight work finishes and the database pool
      // is released; a second signal means the operator is impatient, so exit now.
      let shuttingDown = false;
      const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) {
          logger.warn(`Received ${signal} again; exiting now.`);
          process.exit(1);
        }
        shuttingDown = true;
        logger.info(`Received ${signal}; shutting down.`);
        await server.stop();
        process.exit(0);
      };

      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));

      // Resolving here would end the process, so serve deliberately never returns.
      await new Promise<never>(() => {});
    });
}

export function buildMigrateCommand(): Command {
  return new Command('migrate').description('apply pending database migrations and exit').action(async (_options: unknown, command: Command) => {
    const pool = createPool({ connectionString: loadConfig(configOption(command)).databaseUrl });
    try {
      const applied = await migrate(pool);
      console.log(applied.length > 0 ? `Applied ${applied.length} migration(s): ${applied.join(', ')}` : 'Schema is already up to date.');
    } finally {
      await pool.end();
    }
  });
}

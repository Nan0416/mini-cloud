import { MiniCloudServer, config, createPool, migrate } from '@mini-cloud/service';
import { LoggerFactory } from '@mini-cloud/shared';
import { Command } from 'commander';
import { parsePositiveInteger } from '../args';

const logger = LoggerFactory.getLogger('serve');

export function buildServeCommand(): Command {
  return new Command('serve')
    .description('start the control plane: HTTP API, pub/sub hub and scheduler')
    .option('--port <port>', 'port to listen on', (value) => parsePositiveInteger(value, 'port'))
    .option('--host <host>', 'bind address (default: 127.0.0.1)')
    .option('--database-url <url>', 'PostgreSQL connection string')
    .option('--skip-migrations', 'do not apply pending migrations on startup')
    .action(async (options: { port?: number; host?: string; databaseUrl?: string; skipMigrations?: boolean }) => {
      const effective = {
        ...config,
        port: options.port ?? config.port,
        host: options.host ?? config.host,
        databaseUrl: options.databaseUrl ?? config.databaseUrl,
      };

      const server = await MiniCloudServer.start(effective, { runMigrations: options.skipMigrations !== true });

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
  return new Command('migrate')
    .description('apply pending database migrations and exit')
    .option('--database-url <url>', 'PostgreSQL connection string')
    .action(async (options: { databaseUrl?: string }) => {
      const pool = createPool({ connectionString: options.databaseUrl ?? config.databaseUrl });
      try {
        const applied = await migrate(pool);
        console.log(applied.length > 0 ? `Applied ${applied.length} migration(s): ${applied.join(', ')}` : 'Schema is already up to date.');
      } finally {
        await pool.end();
      }
    });
}

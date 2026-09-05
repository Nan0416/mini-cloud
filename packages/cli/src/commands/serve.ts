import { MiniCloudServer, ServiceConfig, config, createPool, migrate } from '@mini-cloud/service';
import { LoggerFactory } from '@mini-cloud/shared';
import { Command } from 'commander';
import { parsePositiveInteger } from '../args';

const logger = LoggerFactory.getLogger('serve');

export function buildServeCommand(): Command {
  return new Command('serve')
    .description('start the control plane: two HTTP listeners, the pub/sub hub and the scheduler')
    .option('--port <port>', 'internal listener port — agents, pub/sub and the WebSocket (default: 3000)', (value) => parsePositiveInteger(value, 'port'))
    .option('--host <host>', 'internal listener bind address (default: 127.0.0.1)')
    .option('--public-port <port>', 'public listener port — tasks, instances, the fleet (default: 3001)', (value) => parsePositiveInteger(value, 'public-port'))
    .option('--public-host <host>', 'public listener bind address (default: 127.0.0.1)')
    .option('--database-url <url>', 'PostgreSQL connection string')
    .option('--skip-migrations', 'do not apply pending migrations on startup')
    .action(async (options: { port?: number; host?: string; publicPort?: number; publicHost?: string; databaseUrl?: string; skipMigrations?: boolean }) => {
      // `--port` and `--host` stay pointed at the internal listener, under the names
      // they had when there was only one: that is where every already-deployed agent
      // is configured to look.
      const effective: ServiceConfig = {
        ...config,
        internal: { ...config.internal, port: options.port ?? config.internal.port, host: options.host ?? config.internal.host },
        public: { ...config.public, port: options.publicPort ?? config.public.port, host: options.publicHost ?? config.public.host },
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

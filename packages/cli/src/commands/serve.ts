import { LoggerFactory } from '@mini-cloud/shared';
import { MiniCloudServer, config } from '@mini-cloud/service';
import { ParsedArgs, boolFlag, flag } from '../args';

const logger = LoggerFactory.getLogger('serve');

/** `mini-cloud serve` — runs the control plane in the foreground. */
export async function serveCommand(args: ParsedArgs): Promise<void> {
  const portFlag = flag(args, 'port');
  const hostFlag = flag(args, 'host');

  const effective = {
    ...config,
    port: portFlag === undefined ? config.port : Number(portFlag),
    host: hostFlag ?? config.host,
    databaseUrl: flag(args, 'database-url') ?? config.databaseUrl,
  };

  const server = await MiniCloudServer.start(effective, { runMigrations: !boolFlag(args, 'skip-migrations') });

  // Shut down in an orderly way so in-flight work finishes and the database pool is
  // released; a second signal means the operator is impatient, so exit immediately.
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
}

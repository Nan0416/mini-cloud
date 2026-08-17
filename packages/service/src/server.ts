import { LoggerFactory } from '@mini-cloud/shared';
import http from 'http';
import { AddressInfo } from 'net';
import { Pool } from 'pg';
import { migrate } from './data/migrate';
import { createPool } from './data/pool';
import { DependencyFactory } from './dependencies/dependency-factory';
import { WsMessageHub } from './facades/message-hub';
import { Scheduler } from './facades/scheduler';
import { Service } from './service';
import { ServiceConfig } from './stage-config';

const logger = LoggerFactory.getLogger('MiniCloudServer');

export interface StartServerOptions {
  /** Apply pending migrations on startup. Defaults to true. */
  readonly runMigrations?: boolean;
}

/**
 * A running mini-cloud control plane: HTTP API, WebSocket hub and background
 * scheduler, all on one port and in one process.
 */
export class MiniCloudServer {
  private constructor(
    private readonly httpServer: http.Server,
    private readonly hub: WsMessageHub,
    private readonly scheduler: Scheduler,
    private readonly pool: Pool,
  ) {}

  static async start(config: ServiceConfig, options: StartServerOptions = {}): Promise<MiniCloudServer> {
    const pool = createPool({ connectionString: config.databaseUrl });

    if (options.runMigrations !== false) {
      await migrate(pool);
    }

    // The hub attaches to the HTTP server so both share one port, which means the
    // server object must exist before the dependency graph that publishes through it.
    // Requests are routed only once the app is built, a few lines below.
    const httpServer = http.createServer();
    const hub = new WsMessageHub({ server: httpServer, authToken: config.authToken });

    const dependencies = new DependencyFactory({ config, pool, messageHub: hub }).build();
    const app = new Service({
      middleware: dependencies.middleware,
      endpoints: dependencies.endpoints,
      errorHandler: dependencies.errorHandler,
    }).init();
    httpServer.on('request', app);

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(config.port, config.host, () => {
        httpServer.removeListener('error', reject);
        resolve();
      });
    });

    dependencies.scheduler.start();

    const address = httpServer.address();
    const port = address !== null && typeof address !== 'string' ? address.port : config.port;
    logger.info(`mini-cloud is listening on http://${config.host}:${port} (WebSocket at ws://${config.host}:${port}/ws).`);

    return new MiniCloudServer(httpServer, hub, dependencies.scheduler, pool);
  }

  get port(): number {
    const address: AddressInfo | string | null = this.httpServer.address();
    return address !== null && typeof address !== 'string' ? address.port : 0;
  }

  /** Stops accepting work, then releases the hub and the database pool in order. */
  async stop(): Promise<void> {
    logger.info('Shutting down.');
    this.scheduler.stop();
    await this.hub.terminate();
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
    await this.pool.end();
    logger.info('Shutdown complete.');
  }
}

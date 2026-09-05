import { LoggerFactory } from '@mini-cloud/shared';
import type { ErrorRequestHandler, Express } from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { migrate } from './data/migrate';
import { createPool } from './data/pool';
import { Dependencies, DependencyFactory, PlaneDependencies } from './dependencies/dependency-factory';
import { WsMessageHub } from './facades/message-hub';
import { Scheduler } from './facades/scheduler';
import { Service } from './service';
import { ListenerConfig, ServiceConfig } from './stage-config';
import { consoleLink } from './utils/console-link';

const logger = LoggerFactory.getLogger('MiniCloudServer');

export interface StartServerOptions {
  /** Apply pending migrations on startup. Defaults to true. */
  readonly runMigrations?: boolean;
}

/** Binds one listener and reports the port it actually got, which `0` makes useful. */
async function listen(server: http.Server, config: ListenerConfig): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return address !== null && typeof address !== 'string' ? address.port : config.port;
}

function portOf(server: http.Server, fallback: number): number {
  const address: AddressInfo | string | null = server.address();
  return address !== null && typeof address !== 'string' ? address.port : fallback;
}

/**
 * A running mini-cloud control plane: two HTTP listeners, the WebSocket hub and the
 * background scheduler, in one process.
 *
 * The listeners exist to be exposed differently, not to isolate anything from each
 * other — they share one scheduler, one pool and one object graph. The *internal* one
 * carries agent reports and the hub and is meant to stay on the home network; the
 * *public* one carries what a person drives and is the only one a port forward should
 * ever point at. Which routes each serves is decided in `DependencyFactory`.
 */
export class MiniCloudServer {
  private constructor(
    private readonly internalServer: http.Server,
    private readonly publicServer: http.Server,
    private readonly hub: WsMessageHub,
    private readonly scheduler: Scheduler,
    private readonly pool: Pool,
    private readonly config: ServiceConfig,
  ) {}

  static async start(config: ServiceConfig, options: StartServerOptions = {}): Promise<MiniCloudServer> {
    assertDistinctListeners(config);

    const pool = createPool({ connectionString: config.databaseUrl });

    // The hub attaches to the internal HTTP server, which is what puts `/ws` on the
    // internal port and nowhere else. Both servers must exist before the dependency
    // graph that publishes through the hub. Requests are routed once the apps are
    // built, a few lines below.
    const internalServer = http.createServer();
    const publicServer = http.createServer();
    const hub = new WsMessageHub({
      server: internalServer,
      trustedSubnets: config.internal.trustedSubnets,
    });

    // Built before the migrations run, so a configuration this process will not accept
    // — a missing public token — is refused before the database is touched. Nothing
    // here queries; the DAOs only hold the pool, and the scheduler starts further down.
    let dependencies: Dependencies;
    try {
      dependencies = new DependencyFactory({ config, pool, messageHub: hub }).build();
    } catch (err) {
      await pool.end();
      throw err;
    }
    internalServer.on('request', buildApp('internal', dependencies.internal, dependencies.errorHandler));
    publicServer.on('request', buildApp('public', dependencies.public, dependencies.errorHandler));

    if (options.runMigrations !== false) {
      await migrate(pool);
    }

    // Both or neither. A second port already in use would otherwise leave the first
    // listener bound and the pool open behind a rejected start, so the retry after
    // freeing the port fails on the port that was fine.
    let internalPort: number;
    let publicPort: number;
    try {
      [internalPort, publicPort] = await Promise.all([listen(internalServer, config.internal), listen(publicServer, config.public)]);
    } catch (err) {
      await Promise.all([closeQuietly(internalServer), closeQuietly(publicServer), hub.terminate(), pool.end()]);
      throw err;
    }

    dependencies.scheduler.start();

    logger.info(`Internal listener (agents, pub/sub) on http://${config.internal.host}:${internalPort} — WebSocket at ws://${config.internal.host}:${internalPort}/ws.`);
    logger.info(`Public listener (console, CLI) on http://${config.public.host}:${publicPort}.`);

    // A second line only when a browser on this machine could actually follow it, so
    // first-time setup is a click rather than a copied hostname and a typed port. The
    // console talks to the public listener, so that is the port it names.
    const link = consoleLink({ consoleUrl: config.consoleUrl, host: config.public.host, port: publicPort });
    if (link !== undefined) {
      logger.info(`Open the console: ${link}`);
    }

    return new MiniCloudServer(internalServer, publicServer, hub, dependencies.scheduler, pool, config);
  }

  /** The port agents and the hub are on. */
  get internalPort(): number {
    return portOf(this.internalServer, this.config.internal.port);
  }

  /** The port the console and the CLI are on. */
  get publicPort(): number {
    return portOf(this.publicServer, this.config.public.port);
  }

  /** Stops accepting work, then releases the hub and the database pool in order. */
  async stop(): Promise<void> {
    logger.info('Shutting down.');
    this.scheduler.stop();
    await this.hub.terminate();
    await Promise.all([new Promise<void>((resolve) => this.internalServer.close(() => resolve())), new Promise<void>((resolve) => this.publicServer.close(() => resolve()))]);
    await this.pool.end();
    logger.info('Shutdown complete.');
  }
}

function buildApp(name: string, plane: PlaneDependencies, errorHandler: ErrorRequestHandler): Express {
  return new Service({ name, middleware: plane.middleware, endpoints: plane.endpoints, notFound: plane.notFound, errorHandler }).init();
}

/** Closes a server that may never have bound, without turning that into the failure. */
async function closeQuietly(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/**
 * Refuses two listeners on one address before either binds.
 *
 * Left to the kernel this surfaces as `EADDRINUSE` against mini-cloud's own port,
 * which reads as "something else is already running" and sends the operator hunting
 * for a process that does not exist.
 */
function assertDistinctListeners(config: ServiceConfig): void {
  if (config.internal.port === config.public.port && config.internal.host === config.public.host) {
    throw new Error(
      `The internal and public listeners are both configured for ${config.internal.host}:${config.internal.port}. ` +
        'Give them different ports — the split is what keeps agent traffic and the hub off the port you forward.',
    );
  }
}

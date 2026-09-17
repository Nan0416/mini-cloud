import {
  InvalidRequestError,
  LoggerFactory,
  PortInUseError,
  TASK_EVENT_LEVELS,
  assertInteger,
  assertNonEmptyString,
  assertOneOf,
  assertRecord,
  isAddressInUse,
} from '@mini-cloud/shared';
import express, { NextFunction, Request, Response } from 'express';
import http from 'node:http';

const logger = LoggerFactory.getLogger('ReporterEndpoints');

export interface ReporterHandlers {
  onPid(instanceId: string, pid: number): Promise<void>;
  onTermination(instanceId: string): Promise<void>;
  onExit(instanceId: string, code: number): Promise<void>;
  onEvent(instanceId: string, level: 'success' | 'warning' | 'error', payload: unknown, timestamp: number): Promise<void>;
  onHealthCheck(instanceId: string): Promise<void>;
}

/**
 * The loopback HTTP server that `@mini-cloud/reporter` talks to.
 *
 * Local and unauthenticated by design: it is bound to 127.0.0.1, and anything able
 * to reach it is already running as this user on this machine, so a token would add
 * a secret to distribute without adding a boundary.
 */
export class ReporterServer {
  private readonly app: express.Express;
  private server?: http.Server;

  constructor(private readonly handlers: ReporterHandlers) {
    this.app = express();
    this.app.use(express.json({ limit: '64kb' }));

    this.app.post(
      '/pid',
      this.handle(async (body) => this.handlers.onPid(instanceIdOf(body), assertInteger(body['pid'], 'pid'))),
    );

    this.app.post(
      '/termination',
      this.handle(async (body) => this.handlers.onTermination(instanceIdOf(body))),
    );

    this.app.post(
      '/exit',
      this.handle(async (body) => this.handlers.onExit(instanceIdOf(body), assertInteger(body['code'] ?? 0, 'code'))),
    );

    this.app.post(
      '/event',
      this.handle(async (body) =>
        this.handlers.onEvent(
          instanceIdOf(body),
          assertOneOf(body['level'], 'level', TASK_EVENT_LEVELS),
          body['payload'],
          assertInteger(body['timestamp'] ?? Date.now(), 'timestamp'),
        ),
      ),
    );

    this.app.post(
      '/health-check',
      this.handle(async (body) => this.handlers.onHealthCheck(instanceIdOf(body))),
    );

    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof InvalidRequestError) {
        res.status(400).json({ error: err.message });
        return;
      }
      logger.error('Reporter request failed.', err);
      res.status(500).json({ error: 'Internal error' });
    });
  }

  async start(port: number): Promise<number> {
    this.server = http.createServer(this.app);
    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (server === undefined) {
        reject(new Error('Reporter server was disposed before it started.'));
        return;
      }
      // Bound before the agent contacts the service, so a second agent on this machine
      // stops here rather than after registering under the same id.
      const onError = (err: Error): void => {
        reject(
          isAddressInUse(err)
            ? new PortInUseError(
                `127.0.0.1:${port}, the agent's reporter port, is already in use — most likely by another agent on this machine. Stop it, or run this one from a config file with its own agent.id, agent.port and agent.workDir.`,
                'unknown',
              )
            : err,
        );
      };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve();
      });
    });
    const address = this.server?.address();
    const boundPort = address !== null && address !== undefined && typeof address !== 'string' ? address.port : port;
    logger.info(`Reporter API listening on http://127.0.0.1:${boundPort}.`);
    return boundPort;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) {
      return;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.server = undefined;
  }

  private handle(fn: (body: Record<string, unknown>) => Promise<void>) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        await fn(assertRecord(req.body, 'body'));
        res.status(200).json({ ok: true });
      } catch (err) {
        next(err);
      }
    };
  }
}

function instanceIdOf(body: Record<string, unknown>): string {
  return assertNonEmptyString(body['instanceId'], 'instanceId');
}

import { GetHealthResponse, PingResponse } from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { Pool } from 'pg';
import { Endpoints } from './endpoints';

export interface HealthEndpointsProps {
  readonly pool: Pool;
}

export class HealthEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: HealthEndpointsProps) {
    this.router = Router();

    /** Liveness: the process is up and serving. Deliberately touches nothing else. */
    this.router.get('/ping', (_req, res) => {
      const response: PingResponse = { status: 'ok' };
      res.status(200).json(response);
    });

    /** Readiness: the process is up *and* the database answers. */
    this.router.get('/health', async (_req, res) => {
      try {
        await props.pool.query('SELECT 1');
        const response: GetHealthResponse = { status: 'ok', database: 'ok' };
        res.status(200).json(response);
      } catch {
        const response: GetHealthResponse = { status: 'degraded', database: 'unreachable' };
        res.status(503).json(response);
      }
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}

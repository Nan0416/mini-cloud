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
      res.status(200).json({ status: 'ok' });
    });

    /** Readiness: the process is up *and* the database answers. */
    this.router.get('/health', async (_req, res) => {
      try {
        await props.pool.query('SELECT 1');
        res.status(200).json({ status: 'ok', database: 'ok' });
      } catch {
        res.status(503).json({ status: 'degraded', database: 'unreachable' });
      }
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}
